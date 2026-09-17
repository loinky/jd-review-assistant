import "../src/content/review-generator.js";
import assert from "node:assert/strict";

const generate = globalThis.JDRAReviewGenerator.generate;

assert.equal(globalThis.JDRAReviewGenerator.presetCount, 100);

const yogurtReview = generate(
  { productName: "简爱无蔗糖酸奶 130g*12杯" },
  {
    tags: ["口感很好喝 7979", "口感很丝滑 1935", "适合控糖人士 389"],
    reviews: [
      {
        text: "配料表非常干净，只有生牛乳和乳酸菌，口感顺滑浓稠。0蔗糖配方吃起来安心，冷藏后风味更佳，也适合搭配水果和坚果。",
      },
    ],
  },
);

assert.match(yogurtReview, /0蔗糖/u);
assert.match(yogurtReview, /生牛乳和乳酸菌/u);
assert.match(yogurtReview, /顺滑|冷藏|水果/u);
assert.match(yogurtReview, /只有生牛乳|吃起来安心|风味更佳/u);
assert.doesNotMatch(yogurtReview, /商品整体符合预期/u);
assert.doesNotMatch(yogurtReview, /订单规格|实际体验|表现比较|参考价值/u);

const electronicsReview = generate(
  { productName: "无线蓝牙耳机" },
  {
    tags: ["操作简单 328", "续航不错 219"],
    reviews: [
      { text: "连接和操作都很方便，容易上手，续航够用，日常听歌比较稳定。" },
    ],
  },
);

assert.match(electronicsReview, /操作|续航/u);
assert.match(electronicsReview, /日常听歌|连接和操作/u);
assert.doesNotMatch(electronicsReview, /订单规格|实际体验|表现比较|参考价值/u);

const localFoodReview = generate(
  { productName: "大杯槐花粉 大杯", skuText: "大杯" },
  { tags: [], reviews: [] },
);

assert.match(localFoodReview, /槐花粉/u);
assert.match(localFoodReview, /大杯/u);
assert.match(localFoodReview, /细滑/u);
assert.match(localFoodReview, /甜度/u);
assert.doesNotMatch(localFoodReview, /核心功能和细节表现/u);
assert.doesNotMatch(localFoodReview, /订单规格|实际体验|表现比较|参考价值/u);

console.log("评价生成测试通过");
