const statusElement = document.querySelector("#status");
const taskElement = document.querySelector("#task");
const productNameElement = document.querySelector("#product-name");
const taskMetaElement = document.querySelector("#task-meta");
const openReviewButton = document.querySelector("#open-review");
const openProductButton = document.querySelector("#open-product");
const clearTaskButton = document.querySelector("#clear-task");

document.querySelector(".actions").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  button.disabled = true;
  const response = await chrome.runtime.sendMessage({
    type: button.dataset.action,
  });

  if (!response?.ok) {
    statusElement.textContent = response?.error || "操作失败";
    button.disabled = false;
    return;
  }

  if (button.dataset.action === "CLEAR_TASK") {
    await renderState();
  } else {
    window.close();
  }
});

async function renderState() {
  const response = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  if (!response?.ok) {
    statusElement.textContent = response?.error || "读取任务失败";
    return;
  }

  const task = response.task;
  if (!task) {
    statusElement.textContent = "尚未选择待评价商品";
    taskElement.hidden = true;
    openReviewButton.hidden = true;
    openProductButton.hidden = true;
    clearTaskButton.hidden = true;
    return;
  }

  const reviewCount = task.productContext?.reviews?.length || 0;
  const imageCount = task.productContext?.imageUrls?.length || 0;
  statusElement.textContent = task.status === "published"
    ? `顺序评价已完成 ${task.completedCount || 1} 件`
    : task.status === "queue_waiting"
      ? `已完成 ${task.completedCount || 0}/${task.queueLength || 1}，等待下一件`
    : task.status === "publishing"
      ? "评价已准备，正在发表"
      : task.status === "review_ready"
        ? "评价、五星和图片已准备"
        : reviewCount > 0
          ? `已采集 ${reviewCount} 条评论、${imageCount} 张图片`
          : "任务已建立，等待读取商品评论";
  taskElement.hidden = false;
  productNameElement.textContent = task.productName || "未命名商品";
  taskMetaElement.textContent = [
    task.queueLength && `第 ${(task.queueIndex || 0) + 1}/${task.queueLength} 件`,
    task.orderId && `订单 ${task.orderId}`,
    task.skuText,
  ]
    .filter(Boolean)
    .join(" · ");
  openReviewButton.hidden = !task.reviewUrl;
  openProductButton.hidden = !task.productUrl;
  clearTaskButton.hidden = false;
}

renderState();
