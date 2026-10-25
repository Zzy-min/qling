// ============================================================
// 自动上下文压缩开关与阈值（默认开启）
// ============================================================

export interface AutoCompactConfig {
  /** 默认 true；QLING_AUTO_COMPACT=0/false/off 关闭 */
  enabled: boolean;
  /**
   * 触发阈值（本地 token 估计，非 provider usage）。
   * 默认 6000；QLING_COMPACT_MAX_TOKENS 可调。
   */
  maxTokens: number;
  /** 自动压缩时保留的最近消息条数，默认 6 */
  recentKeep: number;
  /** Configured provider context window; null keeps the legacy threshold. */
  windowTokens: number | null;
  /** Trigger ratio used when windowTokens is known. */
  triggerRatio: number;
  /** config window_tokens, known model window, or the legacy 6000 trigger. */
  budgetSource: "window" | "model" | "legacy";
}

import { resolveContextBudget } from "../context-budget.js";
import { lookupModelWindow } from "../providers/presets.js";

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (["0", "false", "off", "no", "disable", "disabled"].includes(v)) return false;
  if (["1", "true", "on", "yes", "enable", "enabled"].includes(v)) return true;
  return fallback;
}

export function resolveAutoCompactConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  model?: string
): AutoCompactConfig {
  const enabled = parseBool(env.QLING_AUTO_COMPACT, true);
  const maxRaw = Number(env.QLING_COMPACT_MAX_TOKENS);
  const explicitMax = Number.isFinite(maxRaw) && maxRaw > 500 ? Math.floor(maxRaw) : 0;
  const windowRaw = Number(env.QLING_CONTEXT_WINDOW_TOKENS);
  const configuredWindow = Number.isFinite(windowRaw) && windowRaw >= 1000 ? Math.floor(windowRaw) : 0;
  const knownWindow = lookupModelWindow(model ?? "")?.contextWindow ?? 0;
  const ratioRaw = Number(env.QLING_COMPACTION_TRIGGER_RATIO);
  let windowTokens = 0;
  let budgetSource: AutoCompactConfig["budgetSource"] = "legacy";
  if (configuredWindow >= 1000) {
    windowTokens = configuredWindow;
    budgetSource = "window";
  } else if (knownWindow >= 1000 && !explicitMax) {
    windowTokens = knownWindow;
    budgetSource = "model";
  }
  const budget = resolveContextBudget({
    windowTokens,
    triggerRatio: Number.isFinite(ratioRaw) ? ratioRaw : undefined,
    legacyMaxTokens: explicitMax || 6000,
  });
  const maxTokens = budget.triggerTokens;
  const keepRaw = Number(env.QLING_COMPACT_RECENT_KEEP);
  const recentKeep =
    Number.isFinite(keepRaw) && keepRaw > 0
      ? Math.min(40, Math.floor(keepRaw))
      : 6;
  return {
    enabled,
    maxTokens,
    recentKeep,
    windowTokens: budget.windowTokens,
    triggerRatio: budget.triggerRatio,
    budgetSource: windowTokens >= 1000 ? budgetSource : "legacy",
  };
}
