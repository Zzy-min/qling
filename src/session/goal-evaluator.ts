import { LlmHttpClient } from "../providers/llm-client.js";
import { apiKeyRequiredForEndpoint, getProviderPreset } from "../providers/presets.js";
import { resolveActiveLlm } from "../providers/resolve-llm.js";

type GoalFetch = typeof fetch;

export type GoalEvaluatorError = "network" | "timeout" | "no_key" | "unparseable";

export interface GoalEvaluationResult {
  done: boolean;
  reason: string;
  error?: GoalEvaluatorError;
}

export interface GoalEvaluatorOptions {
  provider?: string;
  endpoint?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: GoalFetch;
  currentSession?: () => { client: Pick<LlmHttpClient, "chatCompletions">; provider: string; endpoint: string; apiKey: string; model: string };

}

const GOAL_EVALUATION_PROMPT = `你是轻灵的 Goal Evaluator。

任务：判断给定的目标条件是否已经被对话中的证据满足。

约束：
1. 只能基于 transcript 中已经出现的内容判断，不能假设工具已经成功运行。
2. 如果证据不足，必须返回 done=false。
3. 输出必须是严格 JSON，禁止额外文本。

输出格式：
{"done":true,"reason":"一句话理由"}
或
{"done":false,"reason":"一句话理由"}`;

function resolveChatEndpoint(endpoint: string): string {
  return endpoint.endsWith("/chat/completions")
    ? endpoint
    : endpoint.replace(/\/$/, "") + "/chat/completions";
}

function stripCodeFences(text: string): string {
  return text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/, "").trim();
}

export class GoalEvaluator {
  private readonly currentSession?: GoalEvaluatorOptions["currentSession"];
  private readonly dedicated: boolean;
  private readonly sessionModel?: string;
  private readonly provider: string;
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: GoalFetch;

  constructor(options: GoalEvaluatorOptions = {}) {
    this.currentSession = options.currentSession;
    this.sessionModel = options.model ?? process.env.QLING_GOAL_EVALUATOR_MODEL;
    this.dedicated = [options.provider, options.endpoint, options.apiKey, options.fetchImpl,
      process.env.QLING_GOAL_EVALUATOR_PROVIDER, process.env.QLING_GOAL_EVALUATOR_ENDPOINT,
      process.env.QLING_GOAL_EVALUATOR_API_KEY].some(v => v !== undefined);
    const active = resolveActiveLlm(process.env);
    this.provider = options.provider ?? process.env.QLING_GOAL_EVALUATOR_PROVIDER ?? active.provider;
    const sameProvider = this.provider === active.provider;
    const endpoint =
      options.endpoint ??
      process.env.QLING_GOAL_EVALUATOR_ENDPOINT ??
      (sameProvider ? active.endpoint : getProviderPreset(this.provider)?.endpoint || active.endpoint);
    this.endpoint = resolveChatEndpoint(endpoint);
    // A dedicated service must supply its own credential; never cache the active session key.
    this.apiKey = options.apiKey ?? process.env.QLING_GOAL_EVALUATOR_API_KEY ?? "";
    this.model =
      options.model ??
      process.env.QLING_GOAL_EVALUATOR_MODEL ??
      (sameProvider ? active.model : getProviderPreset(this.provider)?.model || active.model);
    this.timeoutMs = options.timeoutMs ?? Number(process.env.QLING_GOAL_EVALUATOR_TIMEOUT_MS ?? "30000");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async evaluate(input: {
    condition: string;
    transcript: string;
  }): Promise<GoalEvaluationResult> {
    if (this.dedicated && (["chatgpt", "grok-account"].includes(this.provider) ||
        ((!this.apiKey || this.apiKey.startsWith("qling-auth:")) && apiKeyRequiredForEndpoint(this.endpoint, this.provider)))) {
      return {
        done: false,
        reason: "goal evaluator 缺少 API key，无法确认条件达成",
        error: "no_key",
      };
    }

    const prompt = `${GOAL_EVALUATION_PROMPT}

【目标条件】
${input.condition}

【Transcript】
${input.transcript.slice(-12_000)}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      if (!this.dedicated) {
        const active = this.currentSession?.() ?? resolveActiveLlm(process.env);
        if (!active.apiKey && apiKeyRequiredForEndpoint(active.endpoint, active.provider)) {
          return { done: false, reason: "goal evaluator 当前连接已退出或缺少凭据；请 /login 后继续", error: "no_key" };
        }
        const client = "client" in active ? active.client : new LlmHttpClient({
          provider: active.provider, endpoint: active.endpoint, apiKey: active.apiKey,
          authStateDir: process.env.QLING_FILE_STATE_DIR, timeoutMs: this.timeoutMs,
        });
        const result = await client.chatCompletions({ model: this.sessionModel || active.model, systemPrompt: GOAL_EVALUATION_PROMPT,
          messages: [{role:"user", content:prompt}], tools: [], signal:controller.signal,
          overrides: {temperature:0, max_tokens:120} });
        return this.parse(result.content);
      }
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.provider === "local" || !this.apiKey ? {} : { Authorization: `Bearer ${this.apiKey}` }),
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          max_tokens: 120,
          messages: [
            { role: "user", content: prompt },
          ],
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        return {
          done: false,
          reason: `goal evaluator http ${response.status}`,
          error: "network",
        };
      }
      let data: { choices?: { message?: { content?: string } }[] };
      try {
        data = await response.json() as { choices?: { message?: { content?: string } }[] };
      } catch {
        return {
          done: false,
          reason: "goal evaluator 返回了不可解析结果",
          error: "unparseable",
        };
      }
      const content = data.choices?.[0]?.message?.content ?? "";
      return this.parse(content);
    } catch (error) {
      const reason = error instanceof Error && error.message ? error.message : "goal evaluator failed";
      const name = error instanceof Error ? error.name : "";
      const timedOut = name === "AbortError" || name === "TimeoutError" || /timeout|aborted/i.test(reason);
      return {
        done: false,
        reason,
        error: timedOut ? "timeout" : "network",
      };
    } finally {
      clearTimeout(timer);
    }
  }

  parse(raw: string): GoalEvaluationResult {
    try {
      const parsed = JSON.parse(stripCodeFences(raw)) as Partial<GoalEvaluationResult>;
      if (typeof parsed.done === "boolean" && typeof parsed.reason === "string") {
        return { done: parsed.done, reason: parsed.reason };
      }
    } catch {
      // fall through
    }
    return {
      done: false,
      reason: raw.trim() || "goal evaluator 返回了不可解析结果",
      error: "unparseable",
    };
  }
}
