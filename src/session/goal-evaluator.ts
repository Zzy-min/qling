import { LlmHttpClient } from "../providers/llm-client.js";
import { apiKeyRequiredForEndpoint, getProviderPreset } from "../providers/presets.js";
import { resolveActiveLlm } from "../providers/resolve-llm.js";
import type { Message } from "../types.js";

type GoalFetch = typeof fetch;

export type GoalEvaluatorError = "network" | "timeout" | "no_key" | "unparseable";
export type GoalEvaluatorDecision = "continue" | "candidate_complete" | "blocked";

export interface GoalEvaluationResult {
  done: boolean;
  reason: string;
  decision?: GoalEvaluatorDecision;
  evidence?: string;
  nextStep?: string;
  blockerKey?: string;
  error?: GoalEvaluatorError;
}

export interface GoalEvaluatorOptions {
  provider?: string;
  endpoint?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: GoalFetch;
  currentSession?: () => {
    client: Pick<LlmHttpClient, "chatCompletions">;
    provider: string;
    endpoint: string;
    apiKey: string;
    model: string;
  };
}

export const GOAL_TRANSCRIPT_MAX_BYTES = 32 * 1024;
export const GOAL_ITEM_MAX_BYTES = 4 * 1024;

const GOAL_EVALUATION_PROMPT = `你是轻灵的 Goal Evaluator（目标完成审查器）。

任务：基于不可篡改的工具执行记录（[tool_result]）判断给定的目标条件是否已经被满足。

严格审查原则（参考 Grok Build Goal Evaluator）：
1. [agent_message] 是模型单方面的口头自述（untrusted model self-report），绝不能单独作为任务完成的证据。
2. 只有当 transcript 中存在客观证据（如 [tool_result] 输出、文件修改确认、测试通过退出码）证明目标条件已达成时，才允许返回 done=true（或 decision="candidate_complete"）。
3. 若遇到外部环境缺失、权限拒绝或不可克服的矛盾，可返回 decision="blocked" 并提供小写 snake_case 的 blocker_key。
4. 若证据不足或仍有未完成步骤，必须返回 done=false（decision="continue"）。
5. 输出必须是严格 JSON，禁止任何额外文本或 Markdown 代码块。

支持输出格式（任选其一，推荐第二种结构化三态格式）：
格式 A（兼容格式）：
{"done":true,"reason":"一句话证据说明"} 或 {"done":false,"reason":"一句话差距说明"}
格式 B（三态结构化格式）：
{"decision":"continue"|"candidate_complete"|"blocked","evidence":"具体工具证据或缺失项","next_step":"下一步建议","blocker_key":"optional_snake_case_key"}`;

function resolveChatEndpoint(endpoint: string): string {
  return endpoint.endsWith("/chat/completions")
    ? endpoint
    : endpoint.replace(/\/$/, "") + "/chat/completions";
}

function stripCodeFences(text: string): string {
  return text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/, "")
    .trim();
}

export function isValidBlockerKey(key: string): boolean {
  const trimmed = key.trim();
  if (!trimmed || trimmed.length > 64) return false;
  if (trimmed.startsWith("_") || trimmed.endsWith("_") || trimmed.includes("__")) return false;
  return /^[a-z0-9_]+$/.test(trimmed);
}

export function normalizeBlockerKey(raw: string): string {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return slug || "unspecified_blocker";
}

function boundUtf8(value: string, limit: number, keepEnd = false): string {
  const bytes = Buffer.from(value);
  if (bytes.length <= limit) return value;
  if (keepEnd) {
    let start = bytes.length - limit;
    while ((bytes[start]! & 0xc0) === 0x80) start++;
    return bytes.subarray(start).toString("utf8");
  }
  const marker = "…";
  let end = limit - Buffer.byteLength(marker);
  while ((bytes[end]! & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString("utf8") + marker;
}

/** Keep recent tool results first, then fill remaining space with chronological context. */
export function boundedGoalTranscript(messages: readonly Message[]): string {
  const calls = new Map<string, string>();
  for (const message of messages) {
    for (const call of message.tool_calls ?? []) calls.set(call.id, call.function.name);
  }

  const items = new Map<number, string>();
  let remaining = GOAL_TRANSCRIPT_MAX_BYTES;
  for (const toolResultsFirst of [true, false]) {
    for (let i = messages.length - 1; i >= 0 && remaining > 2; i--) {
      const msg = messages[i]!;
      if ((msg.role === "tool") !== toolResultsFirst) continue;
      // Quoting escapes line breaks in model prose and metadata so they cannot introduce record labels.
      const content = JSON.stringify(boundUtf8(msg.content ?? "", GOAL_ITEM_MAX_BYTES));
      let record: string;
      if (msg.role === "tool") {
        const id = msg.tool_call_id ?? "";
        record = `[tool_result] id=${JSON.stringify(boundUtf8(id, 256))} name=${JSON.stringify(boundUtf8(calls.get(id) ?? "", 256))}: ${content}`;
      } else if (msg.role === "assistant") {
        const callSummary = (msg.tool_calls ?? []).slice(0, 8).map(call =>
          JSON.stringify({ id: boundUtf8(call.id, 128), name: boundUtf8(call.function.name, 128), arguments: boundUtf8(call.function.arguments, 240) })
        ).join(" ");
        record = `[agent_message] (untrusted model self-report)${callSummary ? " [assistant_tool_calls] " + callSummary : ""}: ${content}`;
      } else {
        record = `[${msg.role}]: ${content}`;
      }
      const line = boundUtf8(record, GOAL_ITEM_MAX_BYTES);
      const used = Buffer.byteLength(line) + (items.size ? 2 : 0);
      if (used > remaining) continue;
      items.set(i, line);
      remaining -= used;
    }
  }
  return [...items.entries()].sort(([a], [b]) => a - b).map(([, line]) => line).join("\n\n");
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
    this.dedicated = [
      options.provider,
      options.endpoint,
      options.apiKey,
      options.fetchImpl,
      process.env.QLING_GOAL_EVALUATOR_PROVIDER,
      process.env.QLING_GOAL_EVALUATOR_ENDPOINT,
      process.env.QLING_GOAL_EVALUATOR_API_KEY,
    ].some((v) => v !== undefined);
    const active = resolveActiveLlm(process.env);
    this.provider =
      options.provider ?? process.env.QLING_GOAL_EVALUATOR_PROVIDER ?? active.provider;
    const sameProvider = this.provider === active.provider;
    const endpoint =
      options.endpoint ??
      process.env.QLING_GOAL_EVALUATOR_ENDPOINT ??
      (sameProvider
        ? active.endpoint
        : getProviderPreset(this.provider)?.endpoint || active.endpoint);
    this.endpoint = resolveChatEndpoint(endpoint);
    // A dedicated service must supply its own credential; never cache the active session key.
    this.apiKey = options.apiKey ?? process.env.QLING_GOAL_EVALUATOR_API_KEY ?? "";
    this.model =
      options.model ??
      process.env.QLING_GOAL_EVALUATOR_MODEL ??
      (sameProvider ? active.model : getProviderPreset(this.provider)?.model || active.model);
    this.timeoutMs =
      options.timeoutMs ?? Number(process.env.QLING_GOAL_EVALUATOR_TIMEOUT_MS ?? "30000");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async evaluate(input: {
    condition: string;
    transcript: string;
    plan?: string;
  }): Promise<GoalEvaluationResult> {
    if (
      this.dedicated &&
      (["chatgpt", "grok-account"].includes(this.provider) ||
        ((!this.apiKey || this.apiKey.startsWith("qling-auth:")) &&
          apiKeyRequiredForEndpoint(this.endpoint, this.provider)))
    ) {
      return {
        done: false,
        reason: "goal evaluator 缺少 API key，无法确认条件达成",
        error: "no_key",
      };
    }

    const planBlock = input.plan?.trim()
      ? `\n\n【当前计划】\n${input.plan.trim().slice(0, 8_000)}`
      : "";
    const prompt = `${GOAL_EVALUATION_PROMPT}

【目标条件】
${input.condition}${planBlock}

【Transcript】
${boundUtf8(input.transcript, GOAL_TRANSCRIPT_MAX_BYTES, true)}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      if (!this.dedicated) {
        const active = this.currentSession?.() ?? resolveActiveLlm(process.env);
        if (!active.apiKey && apiKeyRequiredForEndpoint(active.endpoint, active.provider)) {
          return {
            done: false,
            reason: "goal evaluator 当前连接已退出或缺少凭据；请 /login 后继续",
            error: "no_key",
          };
        }
        const client =
          "client" in active
            ? active.client
            : new LlmHttpClient({
                provider: active.provider,
                endpoint: active.endpoint,
                apiKey: active.apiKey,
                authStateDir: process.env.QLING_FILE_STATE_DIR,
                timeoutMs: this.timeoutMs,
              });
        const result = await client.chatCompletions({
          model: this.sessionModel || active.model,
          systemPrompt: GOAL_EVALUATION_PROMPT,
          messages: [{ role: "user", content: prompt }],
          tools: [],
          signal: controller.signal,
          overrides: { temperature: 0, max_tokens: 180 },
        });
        return this.parse(result.content);
      }
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.provider === "local" || !this.apiKey
            ? {}
            : { Authorization: `Bearer ${this.apiKey}` }),
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          max_tokens: 180,
          messages: [{ role: "user", content: prompt }],
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
        data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
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
      const reason =
        error instanceof Error && error.message ? error.message : "goal evaluator failed";
      const name = error instanceof Error ? error.name : "";
      const timedOut =
        name === "AbortError" || name === "TimeoutError" || /timeout|aborted/i.test(reason);
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
      const cleaned = stripCodeFences(raw);
      const parsed = JSON.parse(cleaned) as Record<string, unknown>;

      // Format B: Grok Build 3-way schema (decision: continue | candidate_complete | blocked)
      if (
        typeof parsed.decision === "string" &&
        ["continue", "candidate_complete", "blocked"].includes(parsed.decision)
      ) {
        const decision = parsed.decision as GoalEvaluatorDecision;
        const evidence = typeof parsed.evidence === "string" ? parsed.evidence.trim() : "";
        const nextStep =
          typeof parsed.next_step === "string"
            ? parsed.next_step.trim()
            : typeof parsed.nextStep === "string"
              ? parsed.nextStep.trim()
              : "";
        const rawReason = typeof parsed.reason === "string" ? parsed.reason.trim() : "";
        const combinedReason = evidence || rawReason || nextStep;
        if (!combinedReason) {
          return {
            done: false,
            reason: "goal evaluator 返回了空证据",
            error: "unparseable",
          };
        }
        const rawBlockerKey =
          typeof parsed.blocker_key === "string"
            ? parsed.blocker_key
            : typeof parsed.blockerKey === "string"
              ? parsed.blockerKey
              : "";
        const blockerKey =
          decision === "blocked"
            ? isValidBlockerKey(rawBlockerKey)
              ? rawBlockerKey.trim()
              : normalizeBlockerKey(rawBlockerKey || combinedReason)
            : undefined;
        return {
          done: decision === "candidate_complete",
          reason: combinedReason,
          decision,
          ...(evidence ? { evidence } : {}),
          ...(nextStep ? { nextStep } : {}),
          ...(blockerKey ? { blockerKey } : {}),
        };
      }

      // Format A: Legacy binary schema ({ done: boolean, reason: string })
      if (typeof parsed.done === "boolean" && typeof parsed.reason === "string") {
        return {
          done: parsed.done,
          reason: parsed.reason,
          decision: parsed.done ? "candidate_complete" : "continue",
        };
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
