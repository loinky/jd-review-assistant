import "../src/shared/human-delay.js";
import assert from "node:assert/strict";

const { MIN_DELAY_MS, MAX_DELAY_MS, getRandomDelay } =
  globalThis.JDRAHumanDelay;

assert.equal(MIN_DELAY_MS, 3000);
assert.equal(MAX_DELAY_MS, 5000);

for (let index = 0; index < 1000; index += 1) {
  const delay = getRandomDelay();
  assert.equal(Number.isInteger(delay), true);
  assert.equal(delay >= MIN_DELAY_MS, true);
  assert.equal(delay <= MAX_DELAY_MS, true);
}

const originalSetTimeout = globalThis.setTimeout;
let scheduledDelay = 0;
globalThis.setTimeout = (callback, delay) => {
  scheduledDelay = delay;
  callback();
  return 0;
};
await globalThis.JDRAHumanDelay.wait();
globalThis.setTimeout = originalSetTimeout;

assert.equal(scheduledDelay >= MIN_DELAY_MS, true);
assert.equal(scheduledDelay <= MAX_DELAY_MS, true);

console.log("随机等待测试通过：每次等待均在 3000-5000ms");
