// ============================================================
// 审批参数指纹：一次性批准只覆盖「同一工具 + 同一参数」的调用
// 对照 Grok 审批作用域，避免批准后参数被替换仍复用凭据
// ============================================================

import { createHash } from "node:crypto";

function canonicalize(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== "object") {
    if (typeof value === "bigint") return String(value);
    if (typeof value === "function" || typeof value === "symbol") return undefined;
    return value;
  }
  if (seen.has(value as object)) return "[Circular]";
  seen.add(value as object);
  if (Array.isArray(value)) return value.map((item) => canonicalize(item, seen));
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    const next = canonicalize(record[key], seen);
    if (next !== undefined) out[key] = next;
  }
  return out;
}

/** 稳定序列化 + SHA-256；参数仅影响作用域，不进入日志。 */
export function fingerprintToolArguments(args?: Record<string, unknown> | null): string {
  const normalized = canonicalize(args ?? {}, new WeakSet<object>());
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}