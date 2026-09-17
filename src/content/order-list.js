(() => {
  let injectTimer = null;
  let currentTasks = [];

  const sort = new URL(location.href).searchParams.get("sort");
  if (sort && sort !== "0") return;

  const toAbsoluteUrl = (value) => {
    if (!value || value.startsWith("javascript:")) return "";
    try {
      const url = new URL(value, location.href);
      url.protocol = "https:";
      return url.href;
    } catch {
      return "";
    }
  };

  const cleanText = (value) => String(value || "").replace(/\s+/g, " ").trim();

  function readProduct(row, body) {
    const reviewLink = row.querySelector(
      '.operate a.btn-def[href*="/myJdcomments/orderVoucher.action"]',
    );
    if (!reviewLink) return null;

    const productLink = row.querySelector('.p-name a[href*="item.jd.com"]');
    const fallbackProductLink = row.querySelector(".p-name a");
    const image = row.querySelector(".p-img img");

    return {
      orderId: cleanText(body.querySelector(".number a")?.textContent),
      orderTime: cleanText(body.querySelector(".dealtime")?.textContent),
      productName: cleanText((productLink || fallbackProductLink)?.textContent),
      productUrl: toAbsoluteUrl(productLink?.getAttribute("href")),
      productImage: toAbsoluteUrl(
        image?.currentSrc ||
          image?.getAttribute("src") ||
          image?.getAttribute("data-src"),
      ),
      quantity: cleanText(row.querySelector(".goods-number")?.textContent),
      reviewUrl: toAbsoluteUrl(reviewLink.getAttribute("href")),
    };
  }

  function collectTasks(table) {
    const tasks = [];
    for (const body of table.tBodies) {
      for (const row of body.querySelectorAll("tr.tr-bd")) {
        const task = readProduct(row, body);
        if (task) tasks.push(task);
      }
    }
    return tasks;
  }

  function createQueueButton() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "jdra-action";
    button.addEventListener("click", async () => {
      if (currentTasks.length === 0) return;

      button.disabled = true;
      button.textContent = "正在启动";
      try {
        const response = await chrome.runtime.sendMessage({
          type: "START_REVIEW_QUEUE",
          tasks: currentTasks,
        });
        if (!response?.ok) throw new Error(response?.error || "启动失败");
        button.textContent = `已启动 1/${currentTasks.length}`;
      } catch (error) {
        button.disabled = false;
        button.textContent = "重试顺序评价";
        button.title = error.message;
      }
    });
    return button;
  }

  function injectPageBar(table, count) {
    let bar = document.querySelector(".jdra-page-bar");
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "jdra-page-bar";
      bar.innerHTML = `
        <div class="jdra-page-copy">
          <strong>京东评价助手</strong>
          <span class="jdra-page-status"></span>
        </div>
      `;
      bar.append(createQueueButton());
      table.parentElement?.insertBefore(bar, table);
    }

    const status = bar.querySelector(".jdra-page-status");
    const button = bar.querySelector(".jdra-action");
    if (status) status.textContent = `当前页已识别 ${count} 件待评价商品`;
    if (button && !button.disabled) {
      button.disabled = count === 0;
      button.textContent = count > 0 ? `按顺序自动评价并发表（${count}）` : "暂无待评价商品";
    }
  }

  function injectOrderActions() {
    const table = document.querySelector("table.order-tb");
    if (!table) return 0;

    document.querySelectorAll(".operate .jdra-action").forEach((node) => node.remove());
    currentTasks = collectTasks(table);
    injectPageBar(table, currentTasks.length);
    return currentTasks.length;
  }

  function scheduleInjection() {
    if (injectTimer !== null) return;
    injectTimer = window.setTimeout(() => {
      injectTimer = null;
      injectOrderActions();
    }, 120);
  }

  injectOrderActions();

  const observer = new MutationObserver(scheduleInjection);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
