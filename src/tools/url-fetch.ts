import type { ToolDefinition, ToolResult } from "../types.js";
import { toolError, toolSuccess } from "./error-utils.js";
import { appendGuardAudit, checkUrlFetchPolicy, redactText } from "../guard.js";
import { guardConfigFromEnv } from "../config.js";

const MAX_BODY_CHARS = 200_000;
const MAX_BODY_BYTES = MAX_BODY_CHARS * 4;

export const urlFetchTool: ToolDefinition = {
  name: "url_fetch",
  description:
    "Fetch HTTP/HTTPS resources with Guard policy (allowlist, private IP block, redirect policy, redaction).",
  longDescription: `结构化网络请求工具，受 Guard 策略约束。

**主要能力**:
- 仅允许命中的 URL 前缀（默认 https://）
- 可拦截私网/本地 IP
- 默认跟随重定向（可用 follow_redirects=false 关闭）
- 输出内容自动脱敏

**注意**:
- 不限定具体业务接口；由任务与用户指定 URL
- 展示数据时写明来源与时间字段；多源冲突时说明差异，勿编造
- 非 2xx 可换 URL 重试；HTML 大页优先找更干净的数据接口（若存在）`,
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "Target URL (http/https)" },
      method: { type: "string", description: "HTTP method (GET/POST/PUT/PATCH/DELETE)" },
      headers: { type: "object", description: "Request headers" },
      body: { type: "string", description: "Request body text" },
      timeout_seconds: { type: "number", description: "Request timeout in seconds (default: 30)" },
      follow_redirects: {
        type: "boolean",
        description: "Follow HTTP redirects (default true when guard allows)",
      },
    },
    required: ["url"],
  },
  paramSchema: {
    url: {
      type: "string",
      description: "目标 URL（建议 https://）",
      minLength: 8,
    },
    method: {
      type: "string",
      description: "HTTP 方法",
      enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      default: "GET",
    },
    headers: {
      type: "object",
      description: "请求头对象",
    },
    body: {
      type: "string",
      description: "请求体文本",
    },
    timeout_seconds: {
      type: "number",
      description: "超时秒数，默认 30，最大 120",
      minimum: 1,
      maximum: 120,
      default: 30,
    },
    follow_redirects: {
      type: "boolean",
      description: "是否跟随重定向（默认 true；仅当 guard 允许时生效）",
      default: true,
    },
  },
  examples: [
    'url_fetch url="https://example.com"',
    'url_fetch url="https://api.example.com/v1/data"',
  ],
  scenes: ["web", "data"],
  seeAlso: ["search", "read"],
  priority: 6,
  readOnly: true,
  destructive: false,
  concurrencySafe: true,
  effortHint: "low",
};

export async function runUrlFetch(args: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeout_seconds?: number;
  follow_redirects?: boolean;
}): Promise<ToolResult> {
  const rawUrl = String(args.url ?? "").trim();
  if (!rawUrl) {
    return toolError("URL_FETCH_MISSING_URL", "url is required");
  }

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return toolError("URL_FETCH_INVALID_URL", `invalid url: ${rawUrl}`);
  }

  if (target.protocol !== "https:" && target.protocol !== "http:") {
    return toolError("URL_FETCH_UNSUPPORTED_PROTOCOL", `unsupported protocol: ${target.protocol}`);
  }

  const guard = guardConfigFromEnv();
  const decision = await checkUrlFetchPolicy(target, guard);
  if (!decision.allowed) {
    await appendGuardAudit(guard, {
      tool: "url_fetch",
      action: "deny",
      category: decision.category,
      target: target.toString(),
      reason: decision.reason,
    });
    return toolError("URL_FETCH_GUARD_BLOCKED", decision.reason ?? "guard denied url_fetch");
  }

  let method = String(args.method ?? "GET").trim().toUpperCase();
  const supportedMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
  if (!supportedMethods.has(method)) {
    return toolError("URL_FETCH_UNSUPPORTED_METHOD", `unsupported method: ${method}`);
  }

  const timeoutSeconds = Math.max(1, Math.min(120, Number(args.timeout_seconds ?? 30)));
  // guard 开启跟随时：默认跟随。仅当调用方显式 false 且未触发自动重试时才 manual。
  const guardAllowsFollow = Boolean(guard.network.url_fetch.follow_redirects);
  const followRedirects =
    args.follow_redirects === undefined
      ? guardAllowsFollow
      : Boolean(args.follow_redirects) && guardAllowsFollow;

  const headers = sanitizeHeaders(args.headers ?? {});
  let body = args.body !== undefined ? String(args.body) : undefined;

  let response: Response;
  try {
    const signal = AbortSignal.timeout(timeoutSeconds * 1000);
    let current = target;
    for (let hop = 0; ; hop++) {
      response = await fetch(current.toString(), { method, headers, body, redirect: "manual", signal });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!followRedirects || !location || hop >= 5) {
        return toolError("URL_FETCH_REDIRECT_BLOCKED", "redirect disabled, missing Location, or redirect limit exceeded");
      }
      const next = new URL(location, current);
      const nextDecision = await checkUrlFetchPolicy(next, guard);
      if (!nextDecision.allowed) return toolError("URL_FETCH_REDIRECT_BLOCKED", nextDecision.reason ?? "redirect target denied");
      if (response.status === 303 || ([301, 302].includes(response.status) && method === "POST")) {
        method = "GET"; body = undefined;
      }
      if (method !== "GET" && next.origin !== current.origin) {
        return toolError("URL_FETCH_REDIRECT_BLOCKED", "cross-origin write redirect requires a new explicit request");
      }
      current = next;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await appendGuardAudit(guard, {
      tool: "url_fetch",
      action: "allow",
      category: "network",
      target: target.toString(),
      reason: message,
    });
    return toolError("URL_FETCH_REQUEST_FAILED", message);
  }

  const contentType = response.headers.get("content-type") ?? "";
  let text = "";
  try {
    const textual = /^text\/|json|xml|javascript|yaml|html/i.test(contentType);
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    if (reader) {
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > MAX_BODY_BYTES) {
            await reader.cancel();
            return toolError("URL_FETCH_BODY_TOO_LARGE", `response exceeds ${MAX_BODY_BYTES} bytes`);
          }
          if (textual) text += decoder.decode(chunk.value, { stream: true });
        }
      } finally { reader.releaseLock(); }
    }
    if (textual) text += decoder.decode();
    else text = `[binary response omitted] bytes=${bytes} content-type=${contentType}`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return toolError("URL_FETCH_READ_FAILED", message);
  }

  if (text.length > MAX_BODY_CHARS) {
    text = text.slice(0, MAX_BODY_CHARS) + `\n... [truncated at ${MAX_BODY_CHARS} chars]`;
  }

  text = redactText(text, guard);

  if (!response.ok) {
    await appendGuardAudit(guard, {
      tool: "url_fetch",
      action: "allow",
      category: "network",
      target: target.toString(),
      status: response.status,
      reason: `http status ${response.status}`,
    });
    return toolError(
      "URL_FETCH_HTTP_ERROR",
      `status=${response.status} ${response.statusText}\n${text}`
    );
  }

  await appendGuardAudit(guard, {
    tool: "url_fetch",
    action: "allow",
    category: "network",
    target: target.toString(),
    status: response.status,
  });

  return toolSuccess(
    [
      `status=${response.status}`,
      `content-type=${contentType || "unknown"}`,
      "",
      text,
    ].join("\n")
  );
}

function sanitizeHeaders(input: Record<string, string>): Record<string, string> {
  const forbidden = new Set(["authorization", "proxy-authorization", "cookie", "set-cookie"]);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    const key = k.trim();
    if (!key) continue;
    if (forbidden.has(key.toLowerCase())) continue;
    out[key] = String(v);
  }
  return out;
}
