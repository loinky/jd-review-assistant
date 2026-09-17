(() => {
  let lastContextSignature = "";
  let latestContext = null;
  let collectTimer = null;
  let autoCaptureCompleted = false;
  let collectInProgress = false;
  let pageObserver = null;

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
        imageUrls: [...node.querySelectorAll(".imgs img.img")]
          .map((image) =>
            normalizeImageUrl(
              image.currentSrc || image.getAttribute("src") || image.dataset.src,
            ),
          )
          .filter(Boolean),
      }))
      .filter((review) => review.text);

    const imageUrls = [
      ...new Set(reviews.flatMap((review) => review.imageUrls)),
    ];
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

    try {
      const response = await chrome.runtime.sendMessage({
        type: "SAVE_PRODUCT_CONTEXT",
        context,
      });
      if (!response?.ok) throw new Error(response?.error || "保存评论失败");

      latestContext = context;
      const statusText = response.preparation?.ok
        ? "评价、五星和图片已自动准备"
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
      status.textContent = `${statusText}：${context.reviews.length} 条评论，${context.imageUrls.length} 张图片`;
    }
  }

  async function tryCollect() {
    if (autoCaptureCompleted || collectInProgress) return;
    if (!collectProductContext()) return;

    collectInProgress = true;
    try {
      const context = collectProductContext();
      if (!context) return;
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

    pageObserver = new MutationObserver(scheduleCollect);
    pageObserver.observe(document.documentElement, { childList: true, subtree: true });
    void tryCollect();
  }

  initialize().catch((error) => console.error("[京东评价助手]", error));
})();
