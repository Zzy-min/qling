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
  }): Promise<LlmChatResponse> {
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
      stream: false,
      ...(input.overrides ?? {}),
    };

    let resp;
    try {
      resp = await this.client.post("/chat/completions", payload, { signal: input.signal });
    } catch (err) {
      if (input.signal?.aborted) {
        const canceled = new Error("LLM request canceled");
        canceled.name = "AgentRunCanceledError";
        throw canceled;
      }
      const e = err as {
        code?: string;
        response?: { status?: number; data?: unknown; headers?: Record<string, unknown> };
      };
      const status = e.response?.status;
      const headers = e.response?.headers ?? {};
      const body = e.response?.data as { error?: { code?: string } } | undefined;
      throw new ProviderHttpError({
        provider: this.provider,
        status,
        code: body?.error?.code ?? e.code,
        retryAfterMs: parseRetryAfterMs(headers["retry-after"]),
        requestId: String(headers["x-request-id"] ?? headers["request-id"] ?? "") || undefined,
        retriable: status === undefined || status === 429 || status >= 500,
        detail: sanitizeProviderDetail(e.response?.data ?? e.code ?? "request failed"),
        cause: err,
      });
    }

    const choice = resp.data.choices?.[0];
    if (!choice) {
      throw new Error(`${this.provider} API error: ` + JSON.stringify(resp.data));
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
      extractProviderUsage(resp.data?.usage) ?? extractProviderUsage(resp.data);
    return {
      content: msg.content ?? "",
      tool_calls: rawToolCalls,
      usage,
    };
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
