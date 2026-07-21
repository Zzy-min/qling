import type { ExecutionEvent } from "../execution/types.js";
import type { TokenUsageSource } from "../token-usage.js";
import type { RunOutcome } from "../execution/types.js";

export const HEADLESS_JSON_SCHEMA_VERSION = 1;

export interface HeadlessSessionStats {
  sessionId: string;
  turnCount: number;
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  tokenSource: TokenUsageSource;
  costUsd?: string;
  costIsPartial?: boolean;
  usageIsIncomplete?: boolean;
}

function timestamp(value = Date.now()): string {
  return new Date(value).toISOString();
}

export function formatHeadlessExecutionEvent(event: ExecutionEvent): string {
  return JSON.stringify({
    schemaVersion: HEADLESS_JSON_SCHEMA_VERSION,
    ...event,
    timestamp: timestamp(event.timestamp),
  });
}

export function formatHeadlessResult(result: string | RunOutcome, stats: HeadlessSessionStats): string {
  const outcome = typeof result === "string"
    ? { status: "succeeded" as const, text: result }
    : result;
  return JSON.stringify({
    schemaVersion: HEADLESS_JSON_SCHEMA_VERSION,
    type: "result",
    timestamp: timestamp(),
    ok: outcome.status === "succeeded",
    mode: "run",
    outcome: outcome.status,
    result: outcome.text,
    ...(outcome.status === "paused" && outcome.recovery
      ? {
          recovery: {
            status: outcome.recovery.status,
            remainingStrategyAttempts: outcome.recovery.remainingStrategyAttempts,
            currentStrategy: outcome.recovery.currentStrategy,
          },
        }
      : {}),
    session: {
      id: stats.sessionId,
      turnCount: stats.turnCount,
    },
    usage: {
      totalTokens: stats.tokens,
      promptTokens: stats.promptTokens,
      completionTokens: stats.completionTokens,
      source: stats.tokenSource,
      ...(stats.costUsd ? { costUsd: stats.costUsd } : {}),
      ...(stats.costIsPartial !== undefined ? { costIsPartial: stats.costIsPartial } : {}),
      ...(stats.usageIsIncomplete !== undefined
        ? { usageIsIncomplete: stats.usageIsIncomplete }
        : {}),
    },
  });
}

export function formatHeadlessError(code: string, message: string): string {
  return JSON.stringify({
    schemaVersion: HEADLESS_JSON_SCHEMA_VERSION,
    type: "error",
    timestamp: timestamp(),
    ok: false,
    mode: "run",
    error: { code, message },
  });
}

export function writeHeadlessLine(line: string): void {
  process.stdout.write(`${line}\n`);
}
