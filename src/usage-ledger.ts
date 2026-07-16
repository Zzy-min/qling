import type { ChatUsage } from "./token-usage.js";

export const COST_TICKS_PER_USD = 10_000_000_000n;

export interface UsagePrice {
  inputUsdPerMillion?: string | number;
  outputUsdPerMillion?: string | number;
}

export interface UsageLedgerSnapshot {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costTicks?: string;
  costUsd?: string;
  costIsPartial: boolean;
  usageIsIncomplete: boolean;
  incompleteReasons: string[];
}

function decimalUsdToTicks(value: string | number | undefined): bigint | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const raw = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return undefined;
  const [whole, fraction = ""] = raw.split(".");
  const frac = (fraction + "0000000000").slice(0, 10);
  return BigInt(whole) * COST_TICKS_PER_USD + BigInt(frac);
}

function ticksForTokens(tokens: number, usdPerMillionTicks: bigint): bigint {
  const numerator = BigInt(Math.max(0, Math.floor(tokens))) * usdPerMillionTicks;
  return (numerator + 500_000n) / 1_000_000n;
}

function formatTicksUsd(ticks: bigint): string {
  const whole = ticks / COST_TICKS_PER_USD;
  const fraction = (ticks % COST_TICKS_PER_USD).toString().padStart(10, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export class UsageLedger {
  private promptTokens = 0;
  private completionTokens = 0;
  private costTicks = 0n;
  private hasCompleteCost = true;
  private incompleteReasons = new Set<string>();
  private price: UsagePrice;

  constructor(price: UsagePrice = {}) {
    this.price = price;
  }

  setPrice(price: UsagePrice): void {
    this.price = price;
  }

  record(usage: Pick<ChatUsage, "promptTokens" | "completionTokens">): void {
    const prompt = Math.max(0, Math.floor(usage.promptTokens ?? 0));
    const completion = Math.max(0, Math.floor(usage.completionTokens ?? 0));
    this.promptTokens += prompt;
    this.completionTokens += completion;
    const inputPrice = decimalUsdToTicks(this.price.inputUsdPerMillion);
    const outputPrice = decimalUsdToTicks(this.price.outputUsdPerMillion);
    if (inputPrice === undefined || outputPrice === undefined) {
      this.hasCompleteCost = false;
      this.incompleteReasons.add("model_price_missing");
      return;
    }
    this.costTicks += ticksForTokens(prompt, inputPrice) + ticksForTokens(completion, outputPrice);
  }

  merge(snapshot: UsageLedgerSnapshot): void {
    this.promptTokens += snapshot.promptTokens;
    this.completionTokens += snapshot.completionTokens;
    if (snapshot.costTicks && !snapshot.costIsPartial) {
      this.costTicks += BigInt(snapshot.costTicks);
    } else {
      this.hasCompleteCost = false;
    }
    if (snapshot.usageIsIncomplete) this.incompleteReasons.add("subagent_usage_incomplete");
    for (const reason of snapshot.incompleteReasons) this.incompleteReasons.add(reason);
  }

  markIncomplete(reason: string): void {
    this.incompleteReasons.add(reason);
  }

  reset(): void {
    this.promptTokens = 0;
    this.completionTokens = 0;
    this.costTicks = 0n;
    this.hasCompleteCost = true;
    this.incompleteReasons.clear();
  }

  snapshot(): UsageLedgerSnapshot {
    const incompleteReasons = [...this.incompleteReasons].sort();
    const usageIsIncomplete = incompleteReasons.some((reason) => reason !== "model_price_missing");
    const costIsPartial = !this.hasCompleteCost || usageIsIncomplete;
    return {
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      totalTokens: this.promptTokens + this.completionTokens,
      ...(!costIsPartial
        ? { costTicks: this.costTicks.toString(), costUsd: formatTicksUsd(this.costTicks) }
        : {}),
      costIsPartial,
      usageIsIncomplete,
      incompleteReasons,
    };
  }
}
