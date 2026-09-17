import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(path.join(root, "src/background.js"), "utf8");

let messageListener = null;
let updatedListener = null;
let storedTask = null;
let delayCount = 0;
const createdTabs = [];
const updatedTabs = [];
const removedTabIds = [];

const context = vm.createContext({
  console,
  URL,
  Uint8Array,
  importScripts() {},
  JDRAHumanDelay: {
    async wait() {
      delayCount += 1;
    },
  },
  chrome: {
    runtime: {
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        },
      },
    },
    tabs: {
      onUpdated: {
        addListener(listener) {
          updatedListener = listener;
        },
      },
      async create(options) {
        createdTabs.push(options);
        return { id: 101, ...options };
      },
      async update(tabId, options) {
        updatedTabs.push({ tabId, ...options });
        return { id: tabId, ...options };
      },
      async remove(tabId) {
        removedTabIds.push(tabId);
      },
    },
    storage: {
      local: {
        async get() {
          return { jdReviewAssistantTask: storedTask };
        },
        async set(value) {
          storedTask = value.jdReviewAssistantTask;
        },
        async remove() {
          storedTask = null;
        },
      },
    },
    downloads: { async download() {} },
  },
});

vm.runInContext(source, context, { filename: "src/background.js" });

const tasks = [1, 2].map((index) => ({
  orderId: String(index),
  productName: `测试商品${index}`,
  reviewUrl: `https://club.jd.com/myJdcomments/orderVoucher.action?ruleid=${index}`,
}));

const startResult = await new Promise((resolve) => {
  messageListener(
    { type: "START_REVIEW_QUEUE", tasks },
    { url: "https://club.jd.com/myJdcomments/myJdcomment.action?sort=0" },
    resolve,
  );
});

assert.equal(startResult.ok, true);
assert.equal(storedTask.queueLength, 2);
assert.equal(storedTask.queueIndex, 0);
assert.equal(storedTask.reviewTabId, 101);
assert.equal(createdTabs.length, 1);
assert.equal(delayCount, 1);

storedTask = { ...storedTask, status: "publishing" };
await updatedListener(101, {
  url: "https://club.jd.com/myJdcomments/saveCommentSuccess.action",
});

assert.equal(storedTask.queueIndex, 1);
assert.equal(storedTask.status, "review_detail_pending");
assert.equal(updatedTabs.length, 1);
assert.equal(updatedTabs[0].url, tasks[1].reviewUrl);
assert.equal(delayCount, 2);

storedTask = { ...storedTask, status: "publishing" };
await updatedListener(101, {
  url: "https://club.jd.com/myJdcomments/myJdcomment.action?sort=0",
});

assert.equal(storedTask.status, "published");
assert.equal(storedTask.completedCount, 2);
assert.equal(updatedTabs.length, 1);
assert.equal(delayCount, 2);
assert.deepEqual(removedTabIds, [101]);

console.log("顺序评价队列测试通过");
