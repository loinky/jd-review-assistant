import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

if (manifest.manifest_version !== 3) {
  throw new Error("manifest_version 必须为 3");
}

const JavaScriptFiles = [
  "src/shared/human-delay.js",
  "src/background.js",
  "src/content/order-list.js",
  "src/content/review-generator.js",
  "src/content/review-detail.js",
  "src/content/product-detail.js",
  "src/popup/popup.js",
];

for (const file of JavaScriptFiles) {
  execFileSync(process.execPath, ["--check", path.join(root, file)], {
    stdio: "inherit",
  });
}

const workerPath = path.join(root, manifest.background.service_worker);
const workerSource = readFileSync(workerPath, "utf8");
for (const match of workerSource.matchAll(/importScripts\(["']([^"']+)["']\)/gu)) {
  const importedPath = path.resolve(path.dirname(workerPath), match[1]);
  if (!existsSync(importedPath)) {
    throw new Error(`后台脚本引用不存在：${match[1]}`);
  }
}

console.log(`检查通过：Manifest V${manifest.manifest_version}，${JavaScriptFiles.length} 个脚本语法正确`);
