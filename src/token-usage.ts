// ============================================================
// 轻灵 — 模型官方 Token Usage 解析
// 仅信任 provider 返回字段，不做字符启发式账单估算。
// ============================================================

export type TokenUsageSource = "provider" | "unknown";

export interface ChatUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens: number;
  raw?: Record<string, unknown>;
}

export interface ResolvedTokenUsage {
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  source: TokenUsageSource;
}

function positiveInt(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return undefined;
  const floored = Math.floor(n);
  return floored >= 0 ? floored : undefined;
}

function firstPositive(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    if (!(key in obj)) continue;
    const n = positiveInt(obj[key]);
    if (n !== undefined && n > 0) return n;
    // 允许 0（空 completion 等）
    if (n === 0) return 0;
  }
  return undefined;
}

/**
 * 从 chat/completions 或 Ollama 等响应中提取官方 usage。
 * 支持嵌套 `usage` 与顶层计数字段。
 */
export function extractProviderUsage(raw: unknown): ChatUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;

  const root = raw as Record<string, unknown>;
  const nested =
    root.usage && typeof root.usage === "object"
      ? (root.usage as Record<string, unknown>)
      : root;

  const promptTokens = firstPositive(nested, [
    "prompt_tokens",
    "promptTokens",
    "input_tokens",
    "inputTokens",
    "prompt_eval_count",
    "promptEvalCount",
  ]);
  const completionTokens = firstPositive(nested, [
    "completion_tokens",
    "completionTokens",
    "output_tokens",
    "outputTokens",
    "eval_count",
    "evalCount",
  ]);
  let totalTokens = firstPositive(nested, [
    "total_tokens",
    "totalTokens",
    "total",
  ]);

  if (totalTokens === undefined) {
    if (promptTokens !== undefined || completionTokens !== undefined) {
      totalTokens = (promptTokens ?? 0) + (completionTokens ?? 0);
    }
  }

  if (totalTokens === undefined || totalTokens <= 0) {
    // 若 total 为 0 但有明确 prompt/completion 0 之和，仍视为无有效用量
    if (totalTokens === 0 && (promptTokens ?? 0) + (completionTokens ?? 0) === 0) {
      return undefined;
    }
    if (totalTokens === undefined) return undefined;
  }

  if (totalTokens <= 0) return undefined;

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    raw: nested,
  };
}

/** 将本轮官方 usage 解析为可累加的会话增量。 */
export function resolveRoundTokenUsage(usage: ChatUsage | undefined): ResolvedTokenUsage {
  if (usage && Number.isFinite(usage.totalTokens) && usage.totalTokens > 0) {
    return {
      tokens: Math.floor(usage.totalTokens),
      promptTokens: Math.max(0, Math.floor(usage.promptTokens ?? 0)),
      completionTokens: Math.max(0, Math.floor(usage.completionTokens ?? 0)),
      source: "provider",
    };
  }
  return {
    tokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    source: "unknown",
  };
}

export function formatProviderTokenLine(options: {
  tokens: number;
  promptTokens?: number;
  completionTokens?: number;
  source?: TokenUsageSource;
}): string {
  const tokens = Math.max(0, Math.floor(options.tokens ?? 0));
  const prompt = options.promptTokens;
  const completion = options.completionTokens;
  const source = options.source ?? "unknown";
  if (
    typeof prompt === "number" &&
    typeof completion === "number" &&
    (prompt > 0 || completion > 0)
  ) {
    return `${tokens.toLocaleString()} (in ${prompt.toLocaleString()} + out ${completion.toLocaleString()}, ${source})`;
  }
  return `${tokens.toLocaleString()} (${source})`;
}
