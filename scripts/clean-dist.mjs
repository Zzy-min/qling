#!/usr/bin/env node
/**
 * 清理 dist/，避免陈旧 JS 产物进入 npm pack。
 * 跨平台：仅用 Node fs，不依赖 rimraf/shell。
 */
import { rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

if (existsSync(dist)) {
  rmSync(dist, { recursive: true, force: true });
  console.log("[clean-dist] removed dist/");
} else {
  console.log("[clean-dist] dist/ already absent");
}
