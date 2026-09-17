(() => {
  const AUTO_UPLOAD_LIMIT = 3;
  let initialized = false;
  let currentTask = null;
  let autoFlowStarted = false;

  const cleanText = (value) => String(value || "").replace(/\s+/g, " ").trim();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "AUTO_PREPARE_REVIEW") return false;

    prepareReview(message.task, message.context)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => {
        updateStatus(`自动准备失败：${error.message}`, "error");
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  });

  const toAbsoluteUrl = (value) => {
    if (!value) return "";
    try {
      const url = new URL(value, location.href);
      url.protocol = "https:";
      return url.href;
    } catch {
      return "";
    }
  };

  function readOrderId() {
    return (
      new URL(location.href).searchParams.get("ruleid") ||
      cleanText(document.querySelector('.orderinfo a[href*="orderid="]')?.textContent)
    );
  }

  function readProduct(block) {
    const link = block.querySelector('.comment-goods .p-name a[href*="item.jd.com"]');
    const productNameLink = link || block.querySelector(".comment-goods .p-name a");
    const image = block.querySelector(".comment-goods .p-img img");
    const productUrl = toAbsoluteUrl(link?.getAttribute("href"));
    const productId =
      productUrl.match(/\/(\d+)\.html/)?.[1] ||
      [...block.classList]
        .find((className) => /^product-\d+$/.test(className))
        ?.replace("product-", "") ||
      "";

    return {
      productId,
      productName: cleanText(productNameLink?.textContent),
      productUrl,
      productImage: toAbsoluteUrl(
        image?.currentSrc || image?.getAttribute("src") || image?.dataset.src,
      ),
      skuText: cleanText(block.querySelector(".comment-goods .p-attr")?.textContent),
    };
  }

  function createProductAction(product) {
    const area = document.createElement("div");
    area.className = "jdra-detail-actions";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "jdra-detail-button";
    button.textContent = product.productUrl
      ? "读取评论并自动发表"
      : "无图自动评价并发表";
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "自动处理中";
      try {
        await startAutomaticFlow(product);
      } catch (error) {
        button.disabled = false;
        button.textContent = "重试自动评价";
        button.title = error.message;
        updateStatus(`自动评价失败：${error.message}`, "error");
      }
    });

    area.append(button);
    return area;
  }

  async function initialize() {
    if (initialized) return true;
    const blocks = [...document.querySelectorAll(".f-item.f-goods")];
    if (blocks.length === 0) return initializeServiceReview();

    const products = blocks.map(readProduct).filter((item) => item.productName);
    if (products.length === 0) return false;
    const storedTask = await getStoredTask();
    const selectedProduct = findSelectedProduct(products, storedTask);
    currentTask = await syncTask(selectedProduct);

    for (const block of blocks) {
      const product = readProduct(block);
      const goods = block.querySelector(".comment-goods");
      if (!goods || goods.querySelector(".jdra-detail-actions")) continue;
      goods.append(createProductAction(product));
    }

    injectStatusBand(products.length);
    initialized = true;

    if (currentTask?.productContext?.reviews?.length > 0) {
      await prepareReview(currentTask, currentTask.productContext);
    } else if (currentTask?.autoPublish) {
      await startAutomaticFlow(selectedProduct);
    }
    return true;
  }

  async function getStoredTask() {
    const response = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    return response?.ok ? response.task : null;
  }

  function findSelectedProduct(products, task) {
    if (!task) return products[0];
    return (
      products.find((product) =>
        Boolean(task.productId && product.productId === task.productId),
      ) ||
      products.find((product) =>
        Boolean(task.productUrl && product.productUrl === task.productUrl),
      ) ||
      products.find((product) => product.productName === task.productName) ||
      products[0]
    );
  }

  async function startAutomaticFlow(product) {
    if (autoFlowStarted) return;
    autoFlowStarted = true;

    if (!product.productUrl) {
      updateStatus("该商品没有详情链接，将无图生成评价并自动发表", "working");
      await prepareReview(currentTask, { tags: [], reviews: [], imageUrls: [] });
      return;
    }

    updateStatus("正在打开商品页并读取评论与图片", "working");
    const response = await chrome.runtime.sendMessage({
      type: "OPEN_PRODUCT_PAGE",
      product,
    });
    if (!response?.ok) {
      autoFlowStarted = false;
      throw new Error(response?.error || "打开商品页失败");
    }
  }

  async function initializeServiceReview() {
    const serviceStars = [...document.querySelectorAll(".commstar-group .star5")];
    const publishControl = document.querySelector("a.btn-submit");
    if (serviceStars.length === 0 || !publishControl) return false;

    const task = await getStoredTask();
    if (!task?.autoPublish || task.orderId !== readOrderId()) return false;

    injectServiceStatusBand();
    for (const star of serviceStars) star.click();
    updateStatus(`已完成 ${serviceStars.length} 项服务五星，正在发表`, "working");
    await markTaskPublishing();
    schedulePublish();
    initialized = true;
    return true;
  }

  async function syncTask(product) {
    const response = await chrome.runtime.sendMessage({
      type: "SYNC_REVIEW_DETAIL",
      detail: {
        orderId: readOrderId(),
        reviewUrl: location.href,
        product,
      },
    });
    if (!response?.ok) throw new Error(response?.error || "同步任务失败");
    return response.task;
  }

  async function prepareReview(task, context) {
    const block = findProductBlock(task);
    if (!block) throw new Error("未找到当前商品的评价区域");

    currentTask = task;
    updateStatus("正在生成评价并设置五星", "working");

    const reviewText = generateReviewText(task, context);
    fillReviewText(block, reviewText);
    const scoreCount = setFiveStarRatings(block);

    updateStatus("评价和五星已填写，正在上传评论图片", "working");
    const uploadResult = await uploadReviewImages(block, task, context);
    const imageSummary =
      uploadResult.requested === 0
        ? uploadResult.existing > 0
          ? `已有 ${uploadResult.existing} 张图片`
          : "没有可上传的评论图片"
        : `已上传 ${uploadResult.uploaded}/${uploadResult.requested} 张图片`;

    const canPublish = task?.autoPublish && !uploadResult.pending;
    updateStatus(
      `自动准备完成：评价已填写，${scoreCount} 项五星，${imageSummary}${uploadResult.pending ? "。图片上传未完成，请检查后手动发表" : canPublish ? "，正在发表" : "。请检查后点击发表"}。`,
      uploadResult.warning ? "warning" : "ready",
    );

    let publishScheduled = false;
    if (canPublish) {
      await markTaskPublishing();
      schedulePublish();
      publishScheduled = true;
    }

    return {
      reviewText,
      score: 5,
      scoreCount,
      imagesRequested: uploadResult.requested,
      imagesUploaded: uploadResult.uploaded,
      warning: uploadResult.warning || "",
      publishScheduled,
    };
  }

  async function markTaskPublishing() {
    const response = await chrome.runtime.sendMessage({
      type: "MARK_TASK_PUBLISHING",
    });
    if (!response?.ok) throw new Error(response?.error || "无法标记发表状态");
  }

  function schedulePublish() {
    const publishControl = document.querySelector("a.btn-submit");
    if (!publishControl) throw new Error("未找到发表按钮");
    window.setTimeout(() => publishControl.click(), 100);
  }

  function findProductBlock(task) {
    const blocks = [...document.querySelectorAll(".f-item.f-goods")];
    if (!task?.productId) return blocks[0] || null;
    return (
      blocks.find((block) => readProduct(block).productId === task.productId) ||
      blocks[0] ||
      null
    );
  }

  function generateReviewText(task, context) {
    if (!globalThis.JDRAReviewGenerator?.generate) {
      throw new Error("评价生成器没有加载");
    }
    return globalThis.JDRAReviewGenerator.generate(task, context);
  }

  function fillReviewText(block, text) {
    const textarea = block.querySelector('textarea[placeholder*="分享体验心得"]');
    if (!textarea) throw new Error("未找到评价输入框");

    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    if (valueSetter) valueSetter.call(textarea, text.slice(0, 500));
    else textarea.value = text.slice(0, 500);

    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
  }

  function setFiveStarRatings(block) {
    const stars = [
      block.querySelector(".fop-star .commstar .star5"),
      ...document.querySelectorAll(".commstar-group .commstar .star5"),
    ].filter(Boolean);

    for (const star of stars) star.click();
    return stars.length;
  }

  async function uploadReviewImages(block, task, context) {
    const existingCount = getUploadedImageCount(block);
    const availableSlots = Math.max(0, AUTO_UPLOAD_LIMIT - existingCount);
    const imageUrls = [...new Set(context?.imageUrls || [])];
    if (imageUrls.length === 0 || availableSlots === 0) {
      return { requested: 0, uploaded: 0, existing: existingCount, warning: "" };
    }

    const input = block.querySelector(
      '.thumbnail-list input[type="file"][multiple], .thumbnail-list input[type="file"][accept*="image"]',
    );
    if (!input) {
      return {
        requested: Math.min(imageUrls.length, availableSlots),
        uploaded: 0,
        existing: existingCount,
        warning: "当前商品没有图片上传入口，已跳过图片上传",
      };
    }

    const files = [];
    for (const [index, url] of imageUrls.entries()) {
      if (files.length >= availableSlots) break;
      const response = await chrome.runtime.sendMessage({
        type: "FETCH_REVIEW_IMAGE",
        url,
      });
      if (!response?.ok) continue;
      files.push(dataUrlToFile(response, task, index));
    }

    if (files.length === 0) {
      return {
        requested: Math.min(imageUrls.length, availableSlots),
        uploaded: 0,
        existing: existingCount,
        warning: "没有不超过 4MB 的 JPG、PNG、GIF 或 BMP 评论图片，已跳过图片上传",
      };
    }

    const existingRemoteCount = getRemoteThumbnailCount(block);
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));

    const expectedCount = existingCount + files.length;
    const finalCount = await waitForUploadedImageCount(
      block,
      expectedCount,
      existingRemoteCount + files.length,
      60000,
    );
    const pending = finalCount < expectedCount;
    return {
      requested: files.length,
      uploaded: Math.max(0, finalCount - existingCount),
      existing: existingCount,
      pending,
      warning: pending ? "部分图片仍在上传或上传失败，请检查图片区域" : "",
    };
  }

  function dataUrlToFile(response, task, index) {
    const [, base64 = ""] = response.dataUrl.split(",", 2);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let offset = 0; offset < binary.length; offset += 1) {
      bytes[offset] = binary.charCodeAt(offset);
    }

    const extension = response.extension || ".jpg";
    const productId = cleanText(task?.productId || "product");
    return new File([bytes], `${productId}-${index + 1}${extension}`, {
      type: response.mimeType || "image/jpeg",
      lastModified: Date.now(),
    });
  }

  function getUploadedImageCount(block) {
    const value = block.querySelector(".upload-num em")?.textContent;
    const count = Number.parseInt(value || "0", 10);
    return Number.isFinite(count) ? count : 0;
  }

  function getRemoteThumbnailCount(block) {
    return [...block.querySelectorAll(".thumbnail-list img")].filter((image) => {
      const source = image.getAttribute("src") || image.currentSrc || "";
      return /^https?:\/\//i.test(source) || /^\/\//.test(source);
    }).length;
  }

  function waitForUploadedImageCount(block, expectedCount, expectedRemoteCount, timeoutMs) {
    const uploadedCount = () =>
      getRemoteThumbnailCount(block) >= expectedRemoteCount
        ? getUploadedImageCount(block)
        : Math.min(getUploadedImageCount(block), expectedCount - 1);
    const currentCount = uploadedCount();
    if (currentCount >= expectedCount) return Promise.resolve(currentCount);

    return new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        const count = uploadedCount();
        if (count < expectedCount) return;
        observer.disconnect();
        window.clearTimeout(timer);
        resolve(count);
      });
      const timer = window.setTimeout(() => {
        observer.disconnect();
        resolve(uploadedCount());
      }, timeoutMs);
      observer.observe(block, {
        attributes: true,
        attributeFilter: ["src"],
        childList: true,
        subtree: true,
        characterData: true,
      });
    });
  }

  function injectStatusBand(productCount) {
    if (document.querySelector(".jdra-detail-band")) return;
    const firstBlock = document.querySelector(".f-item.f-goods");
    if (!firstBlock?.parentElement) return;

    const band = document.createElement("div");
    band.className = "jdra-detail-band";
    band.innerHTML = `
      <strong>京东评价助手</strong>
      <span class="jdra-detail-status">已读取 ${productCount} 件商品，点击商品旁的按钮开始自动准备评价。</span>
    `;
    firstBlock.parentElement.insertBefore(band, firstBlock);
  }

  function injectServiceStatusBand() {
    if (document.querySelector(".jdra-detail-band")) return;
    const publishControl = document.querySelector("a.btn-submit");
    if (!publishControl?.parentElement) return;

    const band = document.createElement("div");
    band.className = "jdra-detail-band";
    band.innerHTML = `
      <strong>京东评价助手</strong>
      <span class="jdra-detail-status">正在自动完成服务评价</span>
    `;
    publishControl.parentElement.insertBefore(band, publishControl);
  }

  function updateStatus(message, state) {
    const status = document.querySelector(".jdra-detail-status");
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
  }

  const observer = new MutationObserver(() => {
    initialize()
      .then((ready) => {
        if (ready) observer.disconnect();
      })
      .catch((error) => console.error("[京东评价助手]", error));
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  initialize()
    .then((ready) => {
      if (ready) observer.disconnect();
    })
    .catch((error) => console.error("[京东评价助手]", error));
})();
