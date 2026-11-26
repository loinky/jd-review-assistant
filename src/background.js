importScripts("shared/human-delay.js");

const STORAGE_KEY = "jdReviewAssistantTask";
const PENDING_REVIEWS_URL =
  "https://club.jd.com/myJdcomments/myJdcomment.action?sort=0";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => {
      console.error("[京东评价助手]", error);
      sendResponse({ ok: false, error: error.message });
    });

  return true;
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  const isReviewCompleted =
    changeInfo.url?.includes("club.jd.com/myJdcomments/saveCommentSuccess.action") ||
    changeInfo.url?.includes("club.jd.com/myJdcomments/myJdcomment.action");
  if (!isReviewCompleted) {
    return;
  }

  const task = await readTask();
  if (task?.reviewTabId !== tabId || task.status !== "publishing") return;
  await completeCurrentAndOpenNext(task, tabId);
});

async function handleMessage(message, sender) {
  if (!message || typeof message.type !== "string") {
    throw new Error("无效的消息");
  }

  switch (message.type) {
    case "START_REVIEW_QUEUE":
      assertClubPage(sender);
      return startReviewQueue(message.tasks);
    case "START_REVIEW_TASK":
      assertClubPage(sender);
      return startReviewQueue([message.task]);
    case "SYNC_REVIEW_DETAIL":
      assertClubPage(sender);
      return syncReviewDetail(message.detail, sender);
    case "OPEN_PRODUCT_PAGE":
      assertClubPage(sender);
      return openProductPage(message.product, sender);
    case "SAVE_PRODUCT_CONTEXT":
      assertProductPage(sender);
      return saveProductContext(message.context, sender);
    case "FETCH_REVIEW_IMAGE":
      assertClubPage(sender);
      return fetchReviewImage(message.url);
    case "MARK_TASK_PUBLISHING":
      assertClubPage(sender);
      return markTaskPublishing(sender);
    case "DOWNLOAD_REVIEW_IMAGES":
      assertProductPage(sender);
      return downloadReviewImages(message.payload);
    case "GET_STATE":
      return getState();
    case "OPEN_PENDING_REVIEWS":
      await globalThis.JDRAHumanDelay.wait();
      await chrome.tabs.create({ url: PENDING_REVIEWS_URL, active: true });
      return {};
    case "OPEN_TASK_REVIEW":
      return openStoredUrl("reviewUrl");
    case "OPEN_TASK_PRODUCT":
      return openStoredUrl("productUrl");
    case "CLEAR_TASK":
      await chrome.storage.local.remove(STORAGE_KEY);
      return {};
    default:
      throw new Error(`未知消息类型：${message.type}`);
  }
}

async function startReviewQueue(input) {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error("当前页面没有可评价商品");
  }

  const queue = input.map(normalizeQueueItem);
  for (const item of queue) {
    if (!item.orderId || !item.productName || !item.reviewUrl) {
      throw new Error("订单信息不完整，无法启动顺序评价");
    }
  }

  const task = createQueueTask(queue, 0);
  await chrome.storage.local.set({ [STORAGE_KEY]: task });
  await globalThis.JDRAHumanDelay.wait();
  const reviewTab = await chrome.tabs.create({ url: task.reviewUrl, active: true });
  task.reviewTabId = reviewTab.id;
  await chrome.storage.local.set({ [STORAGE_KEY]: task });
  return { task, queueLength: queue.length };
}

function normalizeQueueItem(input) {
  return {
    orderId: cleanText(input?.orderId, 40),
    orderTime: cleanText(input?.orderTime, 40),
    productName: cleanText(input?.productName, 300),
    productUrl: safeUrl(input?.productUrl, "item.jd.com"),
    productImage: safeImageUrl(input?.productImage),
    quantity: cleanText(input?.quantity, 20),
    reviewUrl: safeUrl(input?.reviewUrl, "club.jd.com"),
  };
}

function createQueueTask(queue, queueIndex, reviewTabId) {
  return {
    ...queue[queueIndex],
    queue,
    queueIndex,
    queueLength: queue.length,
    autoPublish: true,
    status: "review_detail_pending",
    selectedAt: new Date().toISOString(),
    ...(Number.isInteger(reviewTabId) ? { reviewTabId } : {}),
  };
}

async function completeCurrentAndOpenNext(task, tabId) {
  const queue = Array.isArray(task.queue) ? task.queue : [];
  const nextIndex = Number.isInteger(task.queueIndex) ? task.queueIndex + 1 : 1;
  if (nextIndex >= queue.length) {
    await chrome.storage.local.set({
      [STORAGE_KEY]: {
        ...task,
        status: "published",
        completedCount: queue.length || 1,
        publishedAt: new Date().toISOString(),
      },
    });
    await chrome.tabs.remove(tabId);
    return;
  }

  const waitingTask = {
    ...task,
    status: "queue_waiting",
    completedCount: nextIndex,
    publishedAt: new Date().toISOString(),
  };
  await chrome.storage.local.set({ [STORAGE_KEY]: waitingTask });
  await globalThis.JDRAHumanDelay.wait();

  const latestTask = await readTask();
  if (
    latestTask?.status !== "queue_waiting" ||
    latestTask.reviewTabId !== tabId ||
    latestTask.queueIndex !== task.queueIndex
  ) {
    return;
  }

  const nextTask = createQueueTask(queue, nextIndex, tabId);
  await chrome.storage.local.set({ [STORAGE_KEY]: nextTask });
  await chrome.tabs.update(tabId, { url: nextTask.reviewUrl, active: true });
}

async function syncReviewDetail(input, sender) {
  const storedTask = await readTask();
  const orderId = cleanText(input?.orderId, 40);
  const product = normalizeProduct(input?.product);
  const task = {
    ...(storedTask?.orderId === orderId ? storedTask : {}),
    orderId,
    reviewUrl: safeUrl(input?.reviewUrl, "club.jd.com"),
    productName: product.productName,
    productUrl: product.productUrl,
    productImage: product.productImage,
    skuText: product.skuText,
    productId: product.productId,
    reviewTabId: sender.tab?.id,
    status: "review_detail_ready",
    detailReadAt: new Date().toISOString(),
  };

  if (!task.orderId || !task.productName) {
    throw new Error("未能从评价详情读取商品信息");
  }

  await chrome.storage.local.set({ [STORAGE_KEY]: task });
  return { task };
}

async function openProductPage(input, sender) {
  const storedTask = (await readTask()) || {};
  const product = normalizeProduct(input);
  if (!product.productUrl) {
    throw new Error("商品链接不可用");
  }

  const task = {
    ...storedTask,
    ...product,
    reviewTabId: sender.tab?.id || storedTask.reviewTabId,
    status: "product_pending",
    productOpenedAt: new Date().toISOString(),
  };
  await chrome.storage.local.set({ [STORAGE_KEY]: task });
  await globalThis.JDRAHumanDelay.wait();
  const productTab = await chrome.tabs.create({
    url: product.productUrl,
    active: true,
  });
  task.productTabId = productTab.id;
  await chrome.storage.local.set({ [STORAGE_KEY]: task });
  return { task };
}

async function saveProductContext(input, sender) {
  const storedTask = (await readTask()) || {};
  const productUrl = safeUrl(input?.productUrl, "item.jd.com");
  const reviews = Array.isArray(input?.reviews)
    ? input.reviews.slice(0, 20).map((review) => ({
        nickname: cleanText(review?.nickname, 80),
        text: cleanText(review?.text, 2000),
        imageUrls: normalizeImageUrls(review?.imageUrls).slice(0, 9),
      }))
    : [];
  const imageUrls = normalizeImageUrls(input?.imageUrls).slice(0, 30);

  const task = {
    ...storedTask,
    productName:
      storedTask.productName || cleanText(input?.productName, 300),
    productUrl: productUrl || storedTask.productUrl || "",
    productContext: {
      tags: Array.isArray(input?.tags)
        ? input.tags.slice(0, 20).map((item) => cleanText(item, 80))
        : [],
      reviews,
      imageUrls,
      capturedAt: new Date().toISOString(),
    },
    status: "product_context_ready",
  };

  await chrome.storage.local.set({ [STORAGE_KEY]: task });
  const preparation = await prepareReviewTab(task);
  if (preparation?.ok && !preparation.warning &&
      Number.isInteger(task.productTabId) && task.productTabId === sender.tab?.id &&
      task.productTabId !== task.reviewTabId) {
    try {
      await chrome.tabs.remove(task.productTabId);
    } catch (error) {
      console.warn("[京东评价助手] 关闭商品页失败", error.message);
    }
  }
  return {
    task,
    counts: { reviews: reviews.length, images: imageUrls.length },
    preparation,
  };
}

async function prepareReviewTab(task) {
  if (!Number.isInteger(task.reviewTabId)) {
    return { ok: false, error: "评价详情页已关闭，请从插件弹窗重新打开" };
  }

  try {
    await globalThis.JDRAHumanDelay.wait();
    for (let attempt = 0; ; attempt += 1) {
      try {
        await chrome.tabs.update(task.reviewTabId, { active: true });
        break;
      } catch (error) {
        if (!/Tabs cannot be edited right now/i.test(error.message) || attempt >= 20) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    const result = await chrome.tabs.sendMessage(task.reviewTabId, {
      type: "AUTO_PREPARE_REVIEW",
      task,
      context: task.productContext,
    });

    const nextTask = {
      ...task,
      status: result?.ok
        ? result.publishScheduled
          ? "publishing"
          : "review_ready"
        : "review_prepare_failed",
      generatedReview: cleanText(result?.reviewText, 500),
      preparedAt: result?.ok ? new Date().toISOString() : undefined,
      preparationError: result?.ok ? "" : cleanText(result?.error, 300),
    };
    await chrome.storage.local.set({ [STORAGE_KEY]: nextTask });
    return result || { ok: false, error: "评价详情页没有响应" };
  } catch (error) {
    const nextTask = {
      ...task,
      status: "review_prepare_failed",
      preparationError: cleanText(error.message, 300),
    };
    await chrome.storage.local.set({ [STORAGE_KEY]: nextTask });
    return { ok: false, error: error.message };
  }
}

async function markTaskPublishing(sender) {
  const task = await readTask();
  if (!task) throw new Error("当前没有自动评价任务");
  const nextTask = {
    ...task,
    reviewTabId: sender.tab?.id || task.reviewTabId,
    status: "publishing",
    publishingAt: new Date().toISOString(),
  };
  await chrome.storage.local.set({ [STORAGE_KEY]: nextTask });
  return { task: nextTask };
}

async function fetchReviewImage(value) {
  const url = safeImageUrl(value);
  if (!url) throw new Error("评论图片地址无效");

  const response = await fetch(url, {
    credentials: "omit",
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`读取评论图片失败：HTTP ${response.status}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 4 * 1024 * 1024) {
    throw new Error("单张评论图片超过 4MB，已跳过");
  }

  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng =
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
    bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a &&
    bytes[6] === 0x1a && bytes[7] === 0x0a;
  const isGif =
    bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 &&
    bytes[3] === 0x38 && (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61;
  const isBmp = bytes[0] === 0x42 && bytes[1] === 0x4d;
  if (!isJpeg && !isPng && !isGif && !isBmp) {
    throw new Error("评论图片仅支持 JPG、PNG、GIF 和 BMP");
  }

  const mimeType = isJpeg
    ? "image/jpeg"
    : isPng
      ? "image/png"
      : isGif
        ? "image/gif"
        : "image/bmp";
  const extension = isJpeg ? ".jpg" : isPng ? ".png" : isGif ? ".gif" : ".bmp";

  return {
    dataUrl: `data:${mimeType};base64,${bytesToBase64(bytes)}`,
    mimeType,
    extension,
  };
}

async function downloadReviewImages(input) {
  const imageUrls = normalizeImageUrls(input?.imageUrls).slice(0, 30);
  const productName = cleanFilename(input?.productName || "京东商品");

  if (imageUrls.length === 0) {
    throw new Error("当前评论中没有可下载的图片");
  }

  const downloadIds = [];
  for (const [index, url] of imageUrls.entries()) {
    const extension = getImageExtension(url);
    const downloadId = await chrome.downloads.download({
      url,
      filename: `京东评价图片/${productName}/${String(index + 1).padStart(2, "0")}${extension}`,
      conflictAction: "uniquify",
      saveAs: false,
    });
    downloadIds.push(downloadId);
  }

  return { count: downloadIds.length };
}

async function getState() {
  return { task: await readTask(), pendingReviewsUrl: PENDING_REVIEWS_URL };
}

async function openStoredUrl(field) {
  const task = await readTask();
  const url = task?.[field];
  if (!url) {
    throw new Error("当前任务没有可打开的链接");
  }
  await globalThis.JDRAHumanDelay.wait();
  await chrome.tabs.create({ url, active: true });
  return { task };
}

async function readTask() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] || null;
}

function normalizeProduct(input) {
  return {
    productId: cleanText(input?.productId, 40),
    productName: cleanText(input?.productName, 300),
    productUrl: safeUrl(input?.productUrl, "item.jd.com"),
    productImage: safeImageUrl(input?.productImage),
    skuText: cleanText(input?.skuText, 300),
  };
}

function normalizeImageUrls(input) {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map(safeImageUrl).filter(Boolean))];
}

function safeImageUrl(value) {
  const normalizedUrl = safeUrl(value);
  if (!normalizedUrl) return "";
  const url = new URL(normalizedUrl);
  return url.hostname.endsWith("360buyimg.com") ? url.href : "";
}

function safeUrl(value, expectedHostname) {
  if (!value) return "";
  try {
    const url = new URL(value, "https://www.jd.com/");
    if (url.protocol !== "https:") return "";
    if (expectedHostname && url.hostname !== expectedHostname) return "";
    return url.href;
  } catch {
    return "";
  }
}

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanFilename(value) {
  return cleanText(value, 60)
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\.+$/g, "") || "京东商品";
}

function getImageExtension(url) {
  const path = new URL(url).pathname.toLowerCase();
  const match = path.match(/\.(jpe?g|png|gif|webp|bmp)$/);
  if (!match) return ".jpg";
  return match[1] === "jpeg" ? ".jpg" : `.${match[1]}`;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function assertClubPage(sender) {
  if (new URL(sender.url || "https://invalid.local").hostname !== "club.jd.com") {
    throw new Error("消息来源不是京东评价页面");
  }
}

function assertProductPage(sender) {
  if (new URL(sender.url || "https://invalid.local").hostname !== "item.jd.com") {
    throw new Error("消息来源不是京东商品页面");
  }
}
