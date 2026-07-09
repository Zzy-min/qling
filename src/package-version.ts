// ============================================================
// 单一版本来源：读取仓库根 package.json 的 version
// ============================================================

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let cachedVersion: string | null = null;

/**
 * 返回当前包版本（如 1.0.0）。失败时回退 0.0.0。
 * 从 dist/* 向上两级定位 package.json（与 src/dist 布局一致）。
 */
export function getPackageVersion(): string {
  if (cachedVersion) return cachedVersion;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // dist/package-version.js -> repo root; src 编译后同样在 dist/
    const packagePath = join(here, "..", "package.json");
    const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: unknown };
    const version =
      typeof parsed.version === "string" && parsed.version.trim()
        ? parsed.version.trim()
        : "0.0.0";
    cachedVersion = version;
    return version;
  } catch {
    cachedVersion = "0.0.0";
    return cachedVersion;
  }
}

/** CLI / health 展示用，如 qling/1.0.0 */
export function formatCliVersion(binName = "qling"): string {
  return `${binName}/${getPackageVersion()}`;
}

/** daemon health 用，如 1.0.0-daemon */
export function formatDaemonVersion(): string {
  return `${getPackageVersion()}-daemon`;
}

/** 测试可重置缓存 */
export function resetPackageVersionCache(): void {
  cachedVersion = null;
}
