import { hasExecutionProgress } from "./progress-detector.js";
import type { FailureClassification, ProgressSnapshot, RecoveryDecision, RecoveryState } from "./types.js";

export class RecoveryController {
  private readonly sameFingerprintLimit: number;
  private readonly strategyAttemptLimit: number;
  private readonly fingerprintCounts = new Map<string, number>();
  private state: RecoveryState | undefined;

  constructor(options: { sameFingerprintLimit?: number; strategyAttemptLimit?: number } = {}) {
    this.sameFingerprintLimit = options.sameFingerprintLimit ?? 2;
    this.strategyAttemptLimit = options.strategyAttemptLimit ?? 4;
  }

  startRun(input: { runId: string; sessionId: string; originalTask: string }): RecoveryState {
    this.fingerprintCounts.clear();
    this.state = {
      ...input,
      status: "running",
      strategyAttempts: 0,
      remainingStrategyAttempts: this.strategyAttemptLimit,
    };
    return this.getRecoveryState();
  }

  recordFailure(failure: FailureClassification, progress: ProgressSnapshot): RecoveryDecision {
    if (!this.state) throw new Error("recovery run has not started");
    const fingerprint = failure.fingerprint ?? "unknown";
    const count = (this.fingerprintCounts.get(fingerprint) ?? 0) + 1;
    this.fingerprintCounts.set(fingerprint, count);
    const madeProgress = hasExecutionProgress(this.state.lastProgress, progress);
    const strategyAttempts = this.state.strategyAttempts + 1;
    const remainingStrategyAttempts = Math.max(0, this.strategyAttemptLimit - strategyAttempts);
    const mustPause = ["provider_terminal", "permission_required", "permission_denied", "sandbox_denied", "repeated_action"].includes(failure.category);
    let decision: RecoveryDecision;

    if (mustPause) {
      decision = { action: "pause", category: failure.category, reason: failure.category, remainingStrategyAttempts };
    } else if (strategyAttempts >= this.strategyAttemptLimit) {
      decision = { action: "pause", category: failure.category, reason: "strategy_budget_exhausted", remainingStrategyAttempts };
    } else if (count >= this.sameFingerprintLimit && !madeProgress) {
      decision = { action: "pause", category: "no_progress", reason: "same_failure_without_progress", remainingStrategyAttempts };
    } else {
      decision = { action: "recover", category: failure.category, reason: "recovery_available", remainingStrategyAttempts };
    }

    this.state = {
      ...this.state,
      status: decision.action === "recover" ? "recovering" : "paused",
      strategyAttempts,
      remainingStrategyAttempts,
      lastFailure: failure,
      lastProgress: { ...progress, failingTests: progress.failingTests ? [...progress.failingTests] : undefined },
    };
    return decision;
  }

  getRecoveryState(): RecoveryState {
    if (!this.state) throw new Error("recovery run has not started");
    return {
      ...this.state,
      lastFailure: this.state.lastFailure ? { ...this.state.lastFailure } : undefined,
      lastProgress: this.state.lastProgress
        ? { ...this.state.lastProgress, failingTests: this.state.lastProgress.failingTests ? [...this.state.lastProgress.failingTests] : undefined }
        : undefined,
    };
  }

  applyAction(action: "retry" | "next" | "edit" | "cancel"): RecoveryState {
    if (!this.state) throw new Error("recovery run has not started");
    const status = action === "cancel" ? "canceled" : "recovering";
    this.state = { ...this.state, status };
    return this.getRecoveryState();
  }
}
