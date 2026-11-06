// ============================================================
// 轻灵 — OpenAI 兼容 LLM HTTP 客户端（从 AgentLoop 抽出）
// foundation 层：仅 axios + token-usage，无业务副作用。
// ============================================================

import { managedRequestHeaders, isManagedProvider } from "./managed-auth.js";
import { responsesPayload, streamResponses } from "./responses.js";
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
  reasoning_content?: string;
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
  authStateDir?: string;
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
  nonReplayable?: boolean;
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
  readonly nonReplayable?: boolean;
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
      hint = isManagedProvider(options.provider) ? "；账号需要重新授权，请运行 qling login" : `；key 无效或不属于 ${options.provider}`;
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
    this.nonReplayable = options.nonReplayable;
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
  private options: LlmClientOptions;
  private provider: string;
  private endpointHost = "";
  private requestModel = "";
  private accountSecrets = new Set<string>();

  constructor(options: LlmClientOptions) {
    this.options = options;
    this.provider = options.provider ?? "unknown";
    this.endpointHost = endpointHost(options.endpoint);
    this.client = this.buildClient(options);
  }

  reconfigure(options: LlmClientOptions): void {
    this.options = options;
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
    if (this.provider === "chatgpt") {
      for (let attempt=0; attempt<2; attempt++) {
        try { return await streamResponses(this.client, responsesPayload(input), input); }
        catch (error) {
          if (error instanceof Error && error.name === "AgentRunCanceledError") throw error;
          // Only an HTTP rejection before SSE delivery can be retried. Never replay partial turns.
          const rejected = error as {response?:{status?:number;data?:{destroy?:()=>void}};config?:{headers?:{Authorization?:string}}};
          rejected.response?.data?.destroy?.();
          const authorization = rejected.config?.headers?.Authorization;
          if (attempt===0 && rejected.response?.status===401 && authorization?.startsWith("Bearer ")) {
            try { await managedRequestHeaders(this.options,input.signal,authorization.slice(7)); }
            catch {
              if(input.signal?.aborted) throw canceledRequestError();
              throw this.providerError({status:401,code:"needs_login",retriable:false,detail:"Account refresh failed; run qling login"});
            }
            continue;
          }
          throw this.normalizeRequestError(error, input.signal);
        }
      }
      throw this.providerError({code:"needs_login",retriable:false});
    }
    const systemMsg: Message = { role: "system", content: input.systemPrompt };
    const wireMessages = [systemMsg, ...input.messages].map((message) => ({
      role: message.role,
      content: message.content,
      ...(message.role === "assistant" && typeof message.reasoning_content === "string"
        ? { reasoning_content: message.reasoning_content } : {}),
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

    if (input.stream || isManagedProvider(this.provider)) {
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
      if (unsupported && !isManagedProvider(this.provider)) {
        try { input.onStreamFallback?.(`HTTP ${status}`); } catch { /* UI feedback is best-effort */ }
        return this.postNonStreaming(payload, input.signal);
      }
      throw error;
    }

    const contentType = String(resp.headers?.["content-type"] ?? "").toLowerCase();
    if (!contentType.includes("text/event-stream")) {
      if (isManagedProvider(this.provider)) throw this.providerError({code:"invalid_stream",retriable:false,detail:"Account endpoint requires SSE"});
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
    let reasoningContent: string | undefined;
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
            choices?: Array<{ finish_reason?: string | null; delta?: { content?: string; reasoning_content?: string; tool_calls?: Array<{
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
          if (typeof delta?.reasoning_content === "string") {
            reasoningContent = (reasoningContent ?? "") + delta.reasoning_content;
          }
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
      const terminal = error instanceof ProviderHttpError ? error : interrupted(error);
      if (isManagedProvider(this.provider) && receivedBytes > 0) {
        throw this.providerError({status:terminal.status,code:terminal.code,retriable:false,
          nonReplayable:true,detail:"Account stream failed after delivery began; resume explicitly"});
      }
      throw terminal;
    }

    if (!sawDone && !finishReason) {
      if (isManagedProvider(this.provider) && receivedBytes > 0) throw this.providerError({
        code:"stream_interrupted",retriable:false,nonReplayable:true,detail:"Account stream ended before completion; resume explicitly",
      });
      throw interrupted();
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
      ...(reasoningContent !== undefined ? { reasoning_content: reasoningContent } : {}),
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
      ...(typeof msg.reasoning_content === "string" ? { reasoning_content: msg.reasoning_content } : {}),
      tool_calls: rawToolCalls,
      usage,
      streamed,
      ...(finishReason ? { finishReason } : {}),
    };
  }

  private normalizeRequestError(err: unknown, signal?: AbortSignal): Error {
    if (signal?.aborted) return canceledRequestError();
    if (err instanceof ProviderHttpError) return err;
    const e = err as {
      code?: string;
      status?: number;
      nonReplayable?: boolean;
      response?: { status?: number; data?: unknown; headers?: Record<string, unknown> };
    };
    const status = e.response?.status ?? e.status;
    const headers = e.response?.headers ?? {};
    const body = e.response?.data as { error?: { code?: string } } | undefined;
    return this.providerError({
      status,
      code: body?.error?.code ?? e.code,
      retryAfterMs: parseRetryAfterMs(headers["retry-after"]),
      requestId: String(headers["x-request-id"] ?? headers["request-id"] ?? "") || undefined,
      retriable: !e.nonReplayable && (status === undefined || status === 429 || (status !== undefined && status >= 500)),
      nonReplayable: e.nonReplayable,
      detail: sanitizeProviderDetail(e.response?.data ?? e.code ?? (isManagedProvider(this.provider) ? "account request failed; run qling login if authorization expired" : "request failed")),
      cause: isManagedProvider(this.provider) ? undefined : err,
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
      ...(isManagedProvider(this.provider) ? {
        cause: undefined,
        detail: options.detail ? [...this.accountSecrets].reduce((detail,secret)=>detail.split(secret).join("[REDACTED]"),options.detail) : undefined,
      } : {}),
      provider: this.provider,
      model: this.requestModel || undefined,
      endpointHost: this.endpointHost || undefined,
    });
  }

  private buildClient(options: LlmClientOptions): AxiosInstance {
    const client = axios.create({
      baseURL: options.endpoint,
      headers: {
        ...(options.apiKey && !options.apiKey.startsWith("qling-auth:") && !isManagedProvider(options.provider) ? {Authorization: "Bearer " + options.apiKey} : {}),
        "Content-Type": "application/json",
      },
      timeout: options.timeoutMs,
      ...(isManagedProvider(options.provider) ? {maxRedirects:0} : {}),
    });
    client.interceptors.request.use(async config => {
      try {
        const headers = await managedRequestHeaders(options, config.signal as AbortSignal | undefined);
        if (isManagedProvider(options.provider) && headers.Authorization) {
          this.accountSecrets.add(headers.Authorization.slice(7));
          if (this.accountSecrets.size > 4) this.accountSecrets.delete(this.accountSecrets.values().next().value!);
        }
        for (const [name,value] of Object.entries(headers)) config.headers.set(name,value);
        if (options.provider === "grok-account") {
          const payload = typeof config.data === "string" ? JSON.parse(config.data) : config.data;
          if (payload?.model) config.headers.set("x-grok-model-override",payload.model);
        }
        return config;
      } catch (error) {
        if (config.signal?.aborted) throw canceledRequestError();
        throw this.providerError({code:"needs_login",retriable:false,detail:"Connection requires authorization; run qling login"});
      }
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
