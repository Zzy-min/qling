// ============================================================
// 轻灵 — OpenAI 兼容 LLM HTTP 客户端（从 AgentLoop 抽出）
// foundation 层：仅 axios + token-usage，无业务副作用。
// ============================================================

import axios, { type AxiosInstance } from "axios";
import {
  extractProviderUsage,
  type ChatUsage,
} from "../token-usage.js";
import type { Message, RawToolCall, ToolDefinition } from "../types.js";

export interface LlmChatOverrides {
  max_tokens?: number;
  temperature?: number;
  [key: string]: unknown;
}

export interface LlmChatResponse {
  content: string;
  tool_calls?: RawToolCall[];
  usage?: ChatUsage;
  streamed?: boolean;
}

export interface LlmStreamCallbacks {
  stream?: boolean;
  onTextDelta?: (delta: string) => void;
  onStreamFallback?: (reason: string) => void;
}

export interface LlmClientOptions {
  endpoint: string;
  apiKey: string;
  timeoutMs: number;
  provider?: string;
  /** @deprecated Provider retries are owned by AgentLoop; retained for source compatibility. */
  onRetry?: () => void;
}

export interface ProviderHttpErrorOptions {
  provider: string;
  status?: number;
  code?: string;
  retryAfterMs?: number;
  requestId?: string;
  retriable: boolean;
  detail?: string;
  cause?: unknown;
}

export class ProviderHttpError extends Error {
  readonly provider: string;
  readonly status?: number;
  readonly code?: string;
  readonly retryAfterMs?: number;
  readonly requestId?: string;
  readonly retriable: boolean;
  override readonly cause?: unknown;

  constructor(options: ProviderHttpErrorOptions) {
    const statusText = options.status ? ` HTTP ${options.status}` : " transport";
    super(`${options.provider}${statusText} error${options.detail ? `: ${options.detail}` : ""}`);
    this.name = "ProviderHttpError";
    this.provider = options.provider;
    this.status = options.status;
    this.code = options.code;
    this.retryAfterMs = options.retryAfterMs;
    this.requestId = options.requestId;
    this.retriable = options.retriable;
    Object.defineProperty(this, "cause", {
      value: options.cause,
      enumerable: false,
      configurable: true,
    });
  }
}

function sanitizeProviderDetail(value: unknown): string {
  let detail: string;
  try {
    detail = typeof value === "string" ? value : JSON.stringify(value ?? {});
  } catch {
    detail = "provider returned an unreadable error body";
  }
  return detail
    .slice(0, 4 * 1024)
    .replace(/bearer\s+[a-z0-9._~+\/-]+/gi, "Bearer [REDACTED]")
    .replace(/(["']?(?:api[_-]?key|token|secret)["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi, "$1[REDACTED]");
}

function parseRetryAfterMs(value: unknown): number | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

export class LlmHttpClient {
  private client: AxiosInstance;
  private provider: string;

  constructor(options: LlmClientOptions) {
    this.provider = options.provider ?? "unknown";
    this.client = this.buildClient(options);
  }

  reconfigure(options: LlmClientOptions): void {
    this.provider = options.provider ?? this.provider;
    this.client = this.buildClient(options);
  }

  /** Introspection for doctor/tests — request timeout in ms. */
  getTimeoutMs(): number {
    const t = this.client.defaults.timeout;
    return typeof t === "number" ? t : 0;
  }

  async chatCompletions(input: {
    model: string;
    systemPrompt: string;
    messages: Message[];
    tools: ToolDefinition[];
    overrides?: LlmChatOverrides;
    signal?: AbortSignal;
  } & LlmStreamCallbacks): Promise<LlmChatResponse> {
    const systemMsg: Message = { role: "system", content: input.systemPrompt };
    const wireMessages = [systemMsg, ...input.messages].map((message) => ({
      role: message.role,
      content: message.content,
      ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
      ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
    }));
    const payload = {
      model: input.model,
      messages: wireMessages,
      tools: input.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      })),
      ...(input.overrides ?? {}),
    };

    if (input.stream) {
      return this.streamChatCompletions(payload, input);
    }

    return this.postNonStreaming(payload, input.signal);
  }

  private async postNonStreaming(
    payload: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<LlmChatResponse> {

    let resp;
    try {
      resp = await this.client.post("/chat/completions", { ...payload, stream: false }, { signal });
    } catch (err) {
      throw this.normalizeRequestError(err, signal);
    }

    return this.parseChatResponse(resp.data, false);
  }

  private async streamChatCompletions(
    payload: Record<string, unknown>,
    input: { signal?: AbortSignal } & LlmStreamCallbacks
  ): Promise<LlmChatResponse> {
    let resp;
    try {
      resp = await this.client.post("/chat/completions", { ...payload, stream: true }, {
        signal: input.signal,
        responseType: "stream",
        validateStatus: () => true,
      });
    } catch (err) {
      throw this.normalizeRequestError(err, input.signal);
    }

    const status = Number(resp.status ?? 0);
    if (status < 200 || status >= 300) {
      const detail = await readResponseStream(resp.data, 4 * 1024);
      const error = this.providerErrorFromResponse(status, resp.headers ?? {}, detail);
      const unsupported = status === 415 || status === 501 ||
        ([400, 404, 405, 422].includes(status) && /stream|sse|not\s+support|unsupported/i.test(detail));
      if (unsupported) {
        try { input.onStreamFallback?.(`HTTP ${status}`); } catch { /* UI feedback is best-effort */ }
        return this.postNonStreaming(payload, input.signal);
      }
      throw error;
    }

    const contentType = String(resp.headers?.["content-type"] ?? "").toLowerCase();
    if (!contentType.includes("text/event-stream")) {
      const raw = await readResponseStream(resp.data, 8 * 1024 * 1024);
      try {
        return this.parseChatResponse(JSON.parse(raw), false);
      } catch (error) {
        throw new ProviderHttpError({
          provider: this.provider,
          status,
          retriable: false,
          detail: "stream endpoint returned neither SSE nor valid JSON",
          cause: error,
        });
      }
    }

    const toolParts = new Map<number, { id: string; name: string; arguments: string }>();
    let content = "";
    let usage: ChatUsage | undefined;
    let buffer = "";
    const decoder = new TextDecoder();
    try {
      for await (const chunk of resp.data as AsyncIterable<Uint8Array>) {
        if (input.signal?.aborted) throw canceledRequestError();
        buffer = (buffer + decoder.decode(chunk, { stream: true })).replace(/\r\n/g, "\n");
        let boundary: number;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = frame
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (!data || data === "[DONE]") continue;
          const parsed = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string; tool_calls?: Array<{
              index?: number;
              id?: string;
              function?: { name?: string; arguments?: string };
            }> } }>;
            usage?: unknown;
          };
          const delta = parsed.choices?.[0]?.delta;
          if (typeof delta?.content === "string" && delta.content) {
            content += delta.content;
            try { input.onTextDelta?.(delta.content); } catch { /* rendering must not fail the run */ }
          }
          for (const part of delta?.tool_calls ?? []) {
            const index = Number.isInteger(part.index) ? Number(part.index) : 0;
            const current = toolParts.get(index) ?? { id: "", name: "", arguments: "" };
            current.id += part.id ?? "";
            current.name += part.function?.name ?? "";
            current.arguments += part.function?.arguments ?? "";
            toolParts.set(index, current);
          }
          usage = extractProviderUsage(parsed.usage) ?? usage;
        }
      }
    } catch (error) {
      if (input.signal?.aborted) throw canceledRequestError();
      throw new ProviderHttpError({
        provider: this.provider,
        status,
        retriable: false,
        detail: "stream ended before a valid completion",
        cause: error,
      });
    }

    const tool_calls = [...toolParts.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, part], index) => ({
        id: part.id || `stream-call-${index}`,
        type: "function" as const,
        function: { name: part.name, arguments: part.arguments },
      }));
    return {
      content,
      ...(tool_calls.length > 0 ? { tool_calls } : {}),
      usage,
      streamed: true,
    };
  }

  private parseChatResponse(data: any, streamed: boolean): LlmChatResponse {
    const choice = data.choices?.[0];
    if (!choice) {
      throw new Error(`${this.provider} API error: ` + JSON.stringify(data));
    }

    const msg = choice.message;
    let rawToolCalls: RawToolCall[] | undefined;

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      rawToolCalls = msg.tool_calls.map((tc: {
        id: string;
        function: { name: string; arguments: unknown };
      }) => ({
        id: tc.id,
        type: "function" as const,
        function: {
          name: tc.function.name,
          arguments:
            typeof tc.function.arguments === "string"
              ? tc.function.arguments
              : JSON.stringify(tc.function.arguments),
        },
      }));
    }

    const usage =
      extractProviderUsage(data?.usage) ?? extractProviderUsage(data);
    return {
      content: msg.content ?? "",
      tool_calls: rawToolCalls,
      usage,
      streamed,
    };
  }

  private normalizeRequestError(err: unknown, signal?: AbortSignal): Error {
    if (signal?.aborted) return canceledRequestError();
    const e = err as {
      code?: string;
      response?: { status?: number; data?: unknown; headers?: Record<string, unknown> };
    };
    const status = e.response?.status;
    const headers = e.response?.headers ?? {};
    const body = e.response?.data as { error?: { code?: string } } | undefined;
    return new ProviderHttpError({
      provider: this.provider,
      status,
      code: body?.error?.code ?? e.code,
      retryAfterMs: parseRetryAfterMs(headers["retry-after"]),
      requestId: String(headers["x-request-id"] ?? headers["request-id"] ?? "") || undefined,
      retriable: status === undefined || status === 429 || (status !== undefined && status >= 500),
      detail: sanitizeProviderDetail(e.response?.data ?? e.code ?? "request failed"),
      cause: err,
    });
  }

  private providerErrorFromResponse(
    status: number,
    headers: Record<string, unknown>,
    detail: string
  ): ProviderHttpError {
    let code: string | undefined;
    try {
      code = JSON.parse(detail)?.error?.code;
    } catch {
      // plain-text provider error
    }
    return new ProviderHttpError({
      provider: this.provider,
      status,
      code,
      retryAfterMs: parseRetryAfterMs(headers["retry-after"]),
      requestId: String(headers["x-request-id"] ?? headers["request-id"] ?? "") || undefined,
      retriable: status === 429 || status >= 500,
      detail: sanitizeProviderDetail(detail),
    });
  }

  private buildClient(options: LlmClientOptions): AxiosInstance {
    const client = axios.create({
      baseURL: options.endpoint,
      headers: {
        Authorization: "Bearer " + options.apiKey,
        "Content-Type": "application/json",
      },
      timeout: options.timeoutMs,
    });

    return client;
  }
}

function canceledRequestError(): Error {
  const canceled = new Error("LLM request canceled");
  canceled.name = "AgentRunCanceledError";
  return canceled;
}

async function readResponseStream(stream: AsyncIterable<Uint8Array>, maxBytes: number): Promise<string> {
  const decoder = new TextDecoder();
  let bytes = 0;
  let output = "";
  for await (const chunk of stream) {
    const remaining = maxBytes - bytes;
    if (remaining <= 0) break;
    const slice = chunk.byteLength > remaining ? chunk.slice(0, remaining) : chunk;
    bytes += slice.byteLength;
    output += decoder.decode(slice, { stream: true });
  }
  output += decoder.decode();
  return output;
}
