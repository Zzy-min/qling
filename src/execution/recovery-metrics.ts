import type { ExecutionEvent } from "./types.js";

export interface RecoveryMetrics {
  runs: number;
  firstAttemptSuccessRate: number;
  finalSuccessRate: number;
  averageStrategyAttempts: number;
  repeatedFailureRate: number;
  automaticRecoverySuccessRate: number;
  noProgressStops: number;
  /** Runs that entered paused (user intervention surface). */
  pausedRuns: number;
  /** Average ms from first failure to first pause event; 0 when unknown. */
  averageTimeToPauseMs: number;
}

export function calculateRecoveryMetrics(events: ExecutionEvent[]): RecoveryMetrics {
  const runs = new Map<string, ExecutionEvent[]>();
  for (const event of events) {
    const current = runs.get(event.runId) ?? [];
    runs.set(event.runId, [...current, event]);
  }
  let firstAttemptSuccesses = 0;
  let finalSuccesses = 0;
  let strategyAttempts = 0;
  let recoveredSuccesses = 0;
  let runsWithRecovery = 0;
  let repeatedFailures = 0;
  let failures = 0;
  let noProgressStops = 0;
  let pausedRuns = 0;
  let timeToPauseTotal = 0;
  let timeToPauseSamples = 0;

  for (const runEvents of runs.values()) {
    const attempts = runEvents.filter((event) => event.type === "attempt_completed");
    let terminal: ExecutionEvent | undefined;
    for (let index = runEvents.length - 1; index >= 0; index--) {
      if (runEvents[index].type === "run_completed") {
        terminal = runEvents[index];
        break;
      }
    }
    const recoveries = runEvents.filter((event) => event.type === "recovery_started" || event.recoveryAction === "recover");
    const fingerprints = new Set<string>();
    if (attempts[0]?.status === "succeeded") firstAttemptSuccesses++;
    if (terminal?.status === "succeeded") finalSuccesses++;
    strategyAttempts += recoveries.length;
    if (recoveries.length > 0) {
      runsWithRecovery++;
      if (terminal?.status === "succeeded") recoveredSuccesses++;
    }
    const pauseEvent = runEvents.find((event) => event.status === "paused");
    if (pauseEvent) {
      pausedRuns++;
      const firstFailure = runEvents.find(
        (event) => event.type === "failure" || event.type === "verification_failed" || event.status === "failed"
      );
      if (firstFailure && pauseEvent.timestamp >= firstFailure.timestamp) {
        timeToPauseTotal += pauseEvent.timestamp - firstFailure.timestamp;
        timeToPauseSamples++;
      }
    }
    for (const event of runEvents.filter((item) => item.type.includes("failure") || item.type === "failure")) {
      failures++;
      if (event.fingerprint && fingerprints.has(event.fingerprint)) repeatedFailures++;
      if (event.fingerprint) fingerprints.add(event.fingerprint);
      if (event.category === "no_progress") noProgressStops++;
    }
  }

  const runCount = runs.size;
  return {
    runs: runCount,
    firstAttemptSuccessRate: ratio(firstAttemptSuccesses, runCount),
    finalSuccessRate: ratio(finalSuccesses, runCount),
    averageStrategyAttempts: ratio(strategyAttempts, runCount),
    repeatedFailureRate: ratio(repeatedFailures, failures),
    automaticRecoverySuccessRate: ratio(recoveredSuccesses, runsWithRecovery),
    noProgressStops,
    pausedRuns,
    averageTimeToPauseMs: timeToPauseSamples === 0 ? 0 : Math.round(timeToPauseTotal / timeToPauseSamples),
  };
}

function ratio(value: number, total: number): number {
  return total === 0 ? 0 : Number((value / total).toFixed(4));
}
