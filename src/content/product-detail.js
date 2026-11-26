(() => {
  let lastContextSignature = "";
  let latestContext = null;
  let collectTimer = null;
  let autoCaptureCompleted = false;
  let collectInProgress = false;
  let pageObserver = null;
  let captureStartedAt = null;
  let captureSignature = "";
  let captureChangedAt = 0;

  const cleanText = (value) => String(value || "").replace(/\s+/g, " ").trim();

  function normalizeImageUrl(value) {
    if (!value) return "";
    try {
      const url = new URL(value, location.href);
      url.protocol = "https:";
      url.pathname = url.pathname
        .replace(/300x300/gi, "1080x1080")
        .replace(/\.dpg$/i, "");
      return url.href;
    } catch {
      return "";
    }
  }

  function collectProductContext() {
    const root = document.querySelector(".comment-root");
    if (!root) return null;

    const reviewNodes = [...root.querySelectorAll("ul.list > li.item")].slice(0, 20);
    const reviews = reviewNodes
      .map((node) => ({
        nickname: cleanText(node.querySelector(".nickname")?.textContent),
        text: cleanText(node.querySelector(".info")?.textContent),
        imageUrls: [...node.querySelectorAll(".imgs img")]
          .map((image) =>
            normalizeImageUrl(
              image.dataset.lazyImg || image.dataset.src || image.getAttribute("data-original") || image.currentSrc || image.getAttribute("src"),
            ),
          )
          .filter((url) => {
            if (!url) return false;
            return /(^|\.)360buyimg\.com$/i.test(new URL(url).hostname);
          }),
      }))
      .filter((review) => review.text || review.imageUrls.length > 0);

    const interleavedImages = [];
    const maxImages = Math.max(0, ...reviews.map((review) => review.imageUrls.length));
    for (let index = 0; index < maxImages; index += 1) {
      for (const review of reviews) {
        if (review.imageUrls[index]) interleavedImages.push(review.imageUrls[index]);
      }
    }
    const imageUrls = [...new Set(interleavedImages)];
    const tags = [...root.querySelectorAll(".tags > .item")]
      .map((item) => cleanText(item.textContent))
      .filter(Boolean)
      .slice(0, 20);
    const productName = cleanText(
      document.querySelector(".sku-name")?.textContent || document.title.split("【")[0],
    );

    return {
      productName,
      productUrl: location.href,
      tags,
      reviews,
      imageUrls,
    };
  }

  async function saveContext(context) {
    const signature = JSON.stringify(context);
    if (signature === lastContextSignature) return;
    lastContextSignature = signature;
    latestContext = context;
    renderPanel(context, "读取完成，正在准备上传");

    try {
      const response = await chrome.runtime.sendMessage({
        type: "SAVE_PRODUCT_CONTEXT",
        context,
      });
      if (!response?.ok) throw new Error(response?.error || "保存评论失败");

      latestContext = context;
      const statusText = response.preparation?.ok
        ? response.preparation.warning || "评价、五星和图片已自动准备"
        : response.preparation?.error || "评论资料已保存";
      renderPanel(context, statusText);
    } catch (error) {
      lastContextSignature = "";
      throw error;
    }
  }

  function renderPanel(context, statusText) {
    let panel = document.querySelector(".jdra-product-panel");
    if (!panel) {
      panel = document.createElement("aside");
      panel.className = "jdra-product-panel";
      panel.innerHTML = `
        <div class="jdra-product-title">京东评价助手</div>
        <div class="jdra-product-status"></div>
        <div class="jdra-product-actions">
          <button type="button" data-action="capture">重新读取</button>
          <button type="button" data-action="download">下载评论图片</button>
        </div>
      `;
      document.body.append(panel);

      panel
        .querySelector('[data-action="capture"]')
        ?.addEventListener("click", async (event) => {
          const button = event.currentTarget;
          button.disabled = true;
          try {
            const nextContext = collectProductContext();
            if (!nextContext) throw new Error("评论区域尚未加载");
            lastContextSignature = "";
            await saveContext(nextContext);
          } catch (error) {
            renderPanel(latestContext || context, error.message);
          } finally {
            button.disabled = false;
          }
        });

      panel
        .querySelector('[data-action="download"]')
        ?.addEventListener("click", async (event) => {
          const button = event.currentTarget;
          const activeContext = latestContext || context;
          button.disabled = true;
          button.textContent = "正在下载";
          try {
            const response = await chrome.runtime.sendMessage({
              type: "DOWNLOAD_REVIEW_IMAGES",
              payload: {
                productName: activeContext.productName,
                imageUrls: activeContext.imageUrls,
              },
            });
            if (!response?.ok) throw new Error(response?.error || "下载失败");
            button.textContent = `已下载 ${response.count} 张`;
          } catch (error) {
            button.textContent = "重试下载图片";
            renderPanel(activeContext, error.message);
          } finally {
            button.disabled = false;
          }
        });
    }

    const status = panel.querySelector(".jdra-product-status");
    if (status) {
      const message = `${statusText}：${context.reviews.length} 条评论，${context.imageUrls.length} 张图片`;
      if (status.textContent !== message) status.textContent = message;
    }
  }

  async function tryCollect() {
    if (autoCaptureCompleted || collectInProgress) return;
    collectInProgress = true;
    try {
      const context = collectProductContext();
      if (!context) {
        renderPanel({ reviews: [], imageUrls: [] }, "正在等待评论区域加载");
        scheduleCollect();
        return;
      }
      latestContext = context;
      if (captureStartedAt === null) captureStartedAt = Date.now();
      const signature = JSON.stringify(context);
      if (signature !== captureSignature) {
        captureSignature = signature;
        captureChangedAt = Date.now();
      }
      const ready = context.reviews.length >= 3 &&
        context.imageUrls.length > 0 && Date.now() - captureChangedAt >= 1000;
      if (!ready && Date.now() - captureStartedAt < 15000) {
        const elapsed = Math.floor((Date.now() - captureStartedAt) / 1000);
        const phase = context.imageUrls.length === 0
          ? "等待评论图片加载"
          : context.reviews.length < 3 ? "继续读取更多评论" : "等待评论内容稳定";
        renderPanel(context, `${phase}（${elapsed}/15 秒）`);
        scheduleCollect();
        return;
      }
      await saveContext(context);
      autoCaptureCompleted = true;
      pageObserver?.disconnect();
    } catch (error) {
      const context = collectProductContext();
      if (context) renderPanel(context, error.message);
    } finally {
      collectInProgress = false;
    }
  }

  function scheduleCollect() {
    if (collectTimer !== null) return;
    collectTimer = window.setTimeout(() => {
      collectTimer = null;
      void tryCollect();
    }, 200);
  }

  async function initialize() {
    const response = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    if (!response?.ok || !response.task?.productUrl) return;

    const taskUrl = new URL(response.task.productUrl);
    if (taskUrl.hostname !== location.hostname || taskUrl.pathname !== location.pathname) {
      return;
    }

    window.scrollTo({
      top: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
      behavior: "instant",
    });

    let reviewTab = null;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      reviewTab = [...document.querySelectorAll('[role="tab"], a, button, li, span, div')]
        .find((element) =>
          element.getClientRects().length > 0 &&
          /^大家评(?:\s*[（(]?[\d.万千+]+[）)]?)?$/u.test(cleanText(element.textContent)) &&
          ![...element.children].some((child) => cleanText(child.textContent).startsWith("大家评")),
        );
      if (reviewTab) break;
      renderPanel({ reviews: [], imageUrls: [] }, "正在等待“大家评”标签");
      await new Promise((resolve) => window.setTimeout(resolve, 200));
    }
    if (!reviewTab) {
      renderPanel({ reviews: [], imageUrls: [] }, "未找到“大家评”标签，请手动打开后点击重新读取");
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
    reviewTab.click();

    pageObserver = new MutationObserver(scheduleCollect);
    pageObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "srcset", "data-src", "data-lazy-img", "data-original"],
    });
    void tryCollect();
  }

  initialize().catch((error) => console.error("[京东评价助手]", error));
})();
