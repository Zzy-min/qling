export interface CostPricesCny {
  inputPerMillion: number;
  outputPerMillion: number;
}

export interface CostUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface CostBudgetSignal {
  estimatedCostCny: number;
  maxCostCny: number | null;
  exhausted: boolean;
}

function finiteNonNegative(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function resolveCostPricesCny(
  env: NodeJS.ProcessEnv = process.env
): CostPricesCny {
  return {
    inputPerMillion: finiteNonNegative(env.QLING_COST_INPUT_CNY_PER_MILLION, 1),
    outputPerMillion: finiteNonNegative(env.QLING_COST_OUTPUT_CNY_PER_MILLION, 2),
  };
}

export function estimateModelCostCny(
  usage: CostUsage,
  prices: CostPricesCny
): number {
  const promptTokens = finiteNonNegative(usage.promptTokens, 0);
  const completionTokens = finiteNonNegative(usage.completionTokens, 0);
  return (
    (promptTokens * prices.inputPerMillion + completionTokens * prices.outputPerMillion) /
    1_000_000
  );
}

export function resolveCostBudgetSignal(
  usage: CostUsage,
  env: NodeJS.ProcessEnv = process.env
): CostBudgetSignal {
  const estimatedCostCny = estimateModelCostCny(usage, resolveCostPricesCny(env));
  const rawLimit = env.QLING_RUN_MAX_COST_CNY;
  const parsedLimit = Number(rawLimit);
  const maxCostCny = rawLimit !== undefined && Number.isFinite(parsedLimit) && parsedLimit > 0
    ? parsedLimit
    : null;
  return {
    estimatedCostCny,
    maxCostCny,
    exhausted: maxCostCny !== null && estimatedCostCny >= maxCostCny,
  };
}

export function canStartBudgetedTask(
  estimatedSpentCny: number,
  perTaskMaxCny: number,
  batchMaxCny: number
): boolean {
  const spent = finiteNonNegative(estimatedSpentCny, 0);
  const perTask = finiteNonNegative(perTaskMaxCny, 0);
  const batch = finiteNonNegative(batchMaxCny, 0);
  return spent + perTask <= batch;
}
