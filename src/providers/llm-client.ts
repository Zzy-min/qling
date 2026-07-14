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
  /** Invoked once per transport retry attempt. */
  onRetry?: () => void;
}

export class LlmHttpClient {
  private client: AxiosInstance;
  private provider: string;
  private onRetry?: () => void;

  constructor(options: LlmClientOptions) {
    this.provider = options.provider ?? "unknown";
    this.onRetry = options.onRetry;
    this.client = this.buildClient(options);
  }

  reconfigure(options: LlmClientOptions): void {
    this.provider = options.provider ?? this.provider;
    this.onRetry = options.onRetry ?? this.onRetry;
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
  }): Promise<LlmChatResponse> {
    const systemMsg: Message = { role: "system", content: input.systemPrompt };
    const payload = {
      model: input.model,
      messages: [systemMsg, ...input.messages],
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
      resp = await this.client.post("/chat/completions", payload);
    } catch (err) {
      const e = err as { response?: { data?: unknown } };
      const detail = JSON.stringify(e.response?.data ?? {}).slice(0, 500);
      throw new Error(`${this.provider} API error: ` + detail);
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

    client.interceptors.response.use(
      (response) => response,
      async (err) => {
        const cfg = err.config;
        if (!cfg) return Promise.reject(err);
        const maxRetries = 3;
        cfg.__retryCount = cfg.__retryCount ?? 0;
        const status = err.response?.status;
        const shouldRetry =
          (!err.response || status === 429 || (status >= 500 && status <= 503)) &&
          cfg.__retryCount < maxRetries;
        if (shouldRetry) {
          cfg.__retryCount++;
          this.onRetry?.();
          const delay = Math.min(1000 * Math.pow(2, cfg.__retryCount - 1), 10_000);
          await new Promise((r) => setTimeout(r, delay));
          return client(cfg);
        }
        return Promise.reject(err);
      }
    );

    return client;
  }
}
