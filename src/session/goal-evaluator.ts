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
  private readonly provider: string;
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: GoalFetch;

  constructor(options: GoalEvaluatorOptions = {}) {
    this.provider = options.provider ?? process.env.QLING_GOAL_EVALUATOR_PROVIDER ?? process.env.QLING_LLM_PROVIDER ?? "deepseek";
    const endpoint =
      options.endpoint ??
      process.env.QLING_GOAL_EVALUATOR_ENDPOINT ??
      process.env.QLING_LLM_ENDPOINT ??
      (this.provider === "openai" ? "https://api.openai.com/v1" : "https://api.deepseek.com");
    this.endpoint = resolveChatEndpoint(endpoint);
    this.apiKey = options.apiKey ?? process.env.QLING_GOAL_EVALUATOR_API_KEY ?? process.env.QLING_LLM_API_KEY ?? "";
    this.model = options.model ?? process.env.QLING_GOAL_EVALUATOR_MODEL ?? process.env.QLING_LLM_MODEL ?? "deepseek-chat";
    this.timeoutMs = options.timeoutMs ?? Number(process.env.QLING_GOAL_EVALUATOR_TIMEOUT_MS ?? "30000");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async evaluate(input: {
    condition: string;
    transcript: string;
  }): Promise<GoalEvaluationResult> {
    if (!this.apiKey && this.provider !== "local") {
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
