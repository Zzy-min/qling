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
import {
  classifyModelError,
  parseRetryAfterMs,
  resolveStreamIdleMs,
} from "./model-retry.js";
import { endpointHost } from "./resolve-llm.js";

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
  finishReason?: string;
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
  model?: string;
  endpointHost?: string;
  cause?: unknown;
}

export class ProviderHttpError extends Error {
  readonly provider: string;
  readonly status?: number;
  readonly code?: string;
  readonly retryAfterMs?: number;
  readonly requestId?: string;
  readonly retriable: boolean;
  readonly model?: string;
  readonly endpointHost?: string;
  override readonly cause?: unknown;

  constructor(options: ProviderHttpErrorOptions) {
    const statusText = options.status ? ` HTTP ${options.status}` : " transport";
    const detail = options.detail ? `: ${options.detail}` : "";
    const model = options.model ? ` model=${options.model}` : "";
    const host = options.endpointHost ? ` endpoint=${options.endpointHost}` : "";
    let hint = "";
    if (options.status === 401 || options.status === 403) {
      hint = `；key 无效或不属于 ${options.provider}`;
    } else if (options.status === 404 && options.model) {
      hint = "；模型名可能不存在，用 /model list --remote 查看";
    }
    super(`${options.provider}${statusText} error${detail}${model}${host}${hint}`);
    this.name = "ProviderHttpError";
    this.provider = options.provider;
    this.status = options.status;
    this.code = options.code;
    this.retryAfterMs = options.retryAfterMs;
    this.requestId = options.requestId;
    this.retriable = options.retriable;
    this.model = options.model;
    this.endpointHost = options.endpointHost;
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

export class LlmHttpClient {
  private client: AxiosInstance;
  private provider: string;
  private endpointHost = "";
  private requestModel = "";

  constructor(options: LlmClientOptions) {
    this.provider = options.provider ?? "unknown";
    this.endpointHost = endpointHost(options.endpoint);
    this.client = this.buildClient(options);
  }

  reconfigure(options: LlmClientOptions): void {
    this.provider = options.provider ?? this.provider;
    this.endpointHost = endpointHost(options.endpoint);
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
    this.requestModel = input.model;
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
      if (input.signal?.aborted) throw this.normalizeRequestError(err, input.signal);
      const normalized = this.normalizeRequestError(err, input.signal);
      const transport = `${normalized instanceof ProviderHttpError ? normalized.code ?? "" : ""} ${normalized instanceof Error ? normalized.message : ""}`;
      if (normalized instanceof ProviderHttpError && normalized.status === undefined && /econnreset|epipe|econnaborted|socket hang up/i.test(transport)) {
        throw this.providerError({
          code: "stream_interrupted",
          retriable: true,
          detail: "stream interrupted after 0 bytes; tool_call_fragment=no",
          cause: err,
        });
      }
      throw normalized;
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
        throw this.providerError({
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
    let receivedBytes = 0;
    let sawDone = false;
    let finishReason: string | undefined;
    const decoder = new TextDecoder();
    const stream = resp.data as AsyncIterable<Uint8Array> & { destroy?: () => void };
    const iterator = stream[Symbol.asyncIterator]();
    const idleMs = resolveStreamIdleMs();
    const interrupted = (cause?: unknown) => this.providerError({
      code: "stream_interrupted",
      retriable: true,
      detail: `stream interrupted after ${receivedBytes} bytes; tool_call_fragment=${toolParts.size > 0 ? "yes" : "no"}`,
      cause,
    });
    try {
      while (true) {
        if (input.signal?.aborted) throw canceledRequestError();
        const next = await readNextStreamChunk(iterator, idleMs, input.signal, stream);
        if (next.done) break;
        const chunk = next.value;
        receivedBytes += chunk?.byteLength ?? 0;
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
          if (!data) continue;
          if (data === "[DONE]") {
            sawDone = true;
            continue;
          }
          const parsed = JSON.parse(data) as {
            error?: { message?: string; type?: string; code?: string; status?: number };
            choices?: Array<{ finish_reason?: string | null; delta?: { content?: string; tool_calls?: Array<{
              index?: number;
              id?: string;
              function?: { name?: string; arguments?: string };
            }> } }>;
            usage?: unknown;
          };
          if (parsed.error) {
            const upstreamCode = parsed.error.code || parsed.error.type || "upstream_stream_error";
            const upstream = Object.assign(new Error(parsed.error.message || upstreamCode), {
              code: upstreamCode,
              status: parsed.error.status,
              type: parsed.error.type,
            });
            const classification = classifyModelError(upstream);
            throw this.providerError({
              status: classification.status,
              code: upstreamCode,
              retriable: classification.retryable,
              detail: sanitizeProviderDetail(parsed.error.message || parsed.error),
            });
          }
          const choice = parsed.choices?.[0];
          if (typeof choice?.finish_reason === "string" && choice.finish_reason) {
            finishReason = choice.finish_reason;
          }
          const delta = choice?.delta;
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
      if (input.signal?.aborted || (error instanceof Error && error.name === "AgentRunCanceledError")) {
        throw error instanceof Error && error.name === "AgentRunCanceledError" ? error : canceledRequestError();
      }
      if (error instanceof ProviderHttpError) throw error;
      throw interrupted(error);
    }

    if (!sawDone && !finishReason) throw interrupted();

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
      ...(finishReason ? { finishReason } : {}),
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
    const finishReason = typeof choice.finish_reason === "string" ? choice.finish_reason : undefined;
    return {
      content: msg.content ?? "",
      tool_calls: rawToolCalls,
      usage,
      streamed,
      ...(finishReason ? { finishReason } : {}),
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
    return this.providerError({
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
    return this.providerError({
      status,
      code,
      retryAfterMs: parseRetryAfterMs(headers["retry-after"]),
      requestId: String(headers["x-request-id"] ?? headers["request-id"] ?? "") || undefined,
      retriable: status === 429 || status >= 500,
      detail: sanitizeProviderDetail(detail),
    });
  }

  private providerError(
    options: Omit<ProviderHttpErrorOptions, "provider" | "model" | "endpointHost">
  ): ProviderHttpError {
    return new ProviderHttpError({
      ...options,
      provider: this.provider,
      model: this.requestModel || undefined,
      endpointHost: this.endpointHost || undefined,
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

async function readNextStreamChunk(
  iterator: AsyncIterator<Uint8Array>,
  idleMs: number,
  signal: AbortSignal | undefined,
  stream: { destroy?: () => void },
): Promise<IteratorResult<Uint8Array>> {
  if (signal?.aborted) throw canceledRequestError();
  if (!idleMs) return iterator.next();
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      action();
    };
    const onAbort = () => {
      finish(() => {
        try { stream.destroy?.(); } catch { /* already closed */ }
        reject(canceledRequestError());
      });
    };
    timer = setTimeout(() => {
      finish(() => {
        try { stream.destroy?.(); } catch { /* already closed */ }
        const idle = new Error("stream idle timeout");
        (idle as Error & { code?: string }).code = "stream_interrupted";
        reject(idle);
      });
    }, idleMs);
    timer.unref?.();
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    iterator.next().then(
      (result) => finish(() => resolve(result)),
      (error) => finish(() => reject(error)),
    );
  });
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
