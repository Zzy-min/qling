export interface ContextBudgetOptions {
  windowTokens?: number;
  triggerRatio?: number;
  legacyMaxTokens?: number;
}

export interface ContextBudget {
  windowTokens: number | null;
  triggerRatio: number;
  triggerTokens: number;
  source: "window" | "legacy";
}

export function resolveContextBudget(options: ContextBudgetOptions = {}): ContextBudget {
  const ratioRaw = Number(options.triggerRatio ?? 0.85);
  const triggerRatio = Number.isFinite(ratioRaw)
    ? Math.min(0.95, Math.max(0.5, ratioRaw))
    : 0.85;
  const windowRaw = Number(options.windowTokens ?? 0);
  if (Number.isFinite(windowRaw) && windowRaw >= 1000) {
    const windowTokens = Math.floor(windowRaw);
    return {
      windowTokens,
      triggerRatio,
      triggerTokens: Math.max(501, Math.floor(windowTokens * triggerRatio)),
      source: "window",
    };
  }
  const legacyRaw = Number(options.legacyMaxTokens ?? 6000);
  const triggerTokens =
    Number.isFinite(legacyRaw) && legacyRaw > 500 ? Math.floor(legacyRaw) : 6000;
  return {
    windowTokens: null,
    triggerRatio,
    triggerTokens,
    source: "legacy",
  };
}
