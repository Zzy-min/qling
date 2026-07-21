import { hasExecutionProgress } from "./progress-detector.js";
import { RecoveryStrategyPlanner } from "./recovery-strategy-planner.js";
import type { FailureClassification, ProgressSnapshot, RecoveryDecision, RecoveryState } from "./types.js";

export type RecoveryAction = "retry" | "next" | "edit" | "cancel";

export class RecoveryController {
  private readonly sameFingerprintLimit: number;
  private readonly strategyAttemptLimit: number;
  private readonly fingerprintCounts = new Map<string, number>();
  private readonly planner: RecoveryStrategyPlanner;
  private state: RecoveryState | undefined;

  constructor(options: { sameFingerprintLimit?: number; strategyAttemptLimit?: number; planner?: RecoveryStrategyPlanner } = {}) {
    this.sameFingerprintLimit = options.sameFingerprintLimit ?? 2;
    this.strategyAttemptLimit = options.strategyAttemptLimit ?? 4;
    this.planner = options.planner ?? new RecoveryStrategyPlanner();
  }

  startRun(input: { runId: string; sessionId: string; originalTask: string }): RecoveryState {
    this.fingerprintCounts.clear();
    this.state = {
      ...input,
      status: "running",
      strategyAttempts: 0,
      remainingStrategyAttempts: this.strategyAttemptLimit,
      attemptedStrategies: [],
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
    const hardStop = ["provider_terminal", "permission_required", "permission_denied", "sandbox_denied", "repeated_action", "user_canceled"].includes(failure.category);
    const attempted = this.state.attemptedStrategies;
    const recommendedStrategy = this.planner.next(failure.category, attempted);
    let decision: RecoveryDecision;

    if (hardStop) {
      decision = { action: "pause", category: failure.category, reason: failure.category, remainingStrategyAttempts };
    } else if (!recommendedStrategy) {
      decision = { action: "pause", category: failure.category, reason: "no_recovery_strategy", remainingStrategyAttempts };
    } else if (strategyAttempts >= this.strategyAttemptLimit) {
      decision = { action: "pause", category: failure.category, reason: "strategy_budget_exhausted", remainingStrategyAttempts };
    } else if (count >= this.sameFingerprintLimit && !madeProgress) {
      decision = { action: "pause", category: "no_progress", reason: "same_failure_without_progress", remainingStrategyAttempts };
    } else {
      decision = { action: "recover", category: failure.category, reason: "recovery_available", remainingStrategyAttempts, recommendedStrategy };
    }

    const nextState = {
      ...this.state,
      status: decision.action === "recover" ? "recovering" : "paused",
      strategyAttempts,
      remainingStrategyAttempts,
      lastFailure: failure,
      lastProgress: { ...progress, failingTests: progress.failingTests ? [...progress.failingTests] : undefined },
    } satisfies RecoveryState;
    if (decision.recommendedStrategy) {
      nextState.currentStrategy = decision.recommendedStrategy;
      nextState.attemptedStrategies = [...attempted, decision.recommendedStrategy];
    }
    this.state = nextState;
    return decision;
  }

  getRecoveryState(): RecoveryState {
    if (!this.state) throw new Error("recovery run has not started");
    return {
      ...this.state,
      attemptedStrategies: [...this.state.attemptedStrategies],
      lastFailure: this.state.lastFailure ? { ...this.state.lastFailure } : undefined,
      lastProgress: this.state.lastProgress
        ? { ...this.state.lastProgress, failingTests: this.state.lastProgress.failingTests ? [...this.state.lastProgress.failingTests] : undefined }
        : undefined,
    };
  }

  restoreState(state: RecoveryState | null | undefined): void {
    this.fingerprintCounts.clear();
    this.state = state
      ? {
          ...state,
          attemptedStrategies: [...state.attemptedStrategies],
          lastFailure: state.lastFailure ? { ...state.lastFailure } : undefined,
          lastProgress: state.lastProgress ? { ...state.lastProgress } : undefined,
        }
      : undefined;
  }

  applyAction(action: RecoveryAction): RecoveryState {
    if (!this.state) throw new Error("recovery run has not started");
    if (action === "cancel") {
      this.state = { ...this.state, status: "canceled" };
      return this.getRecoveryState();
    }
    if (this.state.status !== "paused") {
      throw new Error("no active paused recovery task");
    }
    if (action === "edit") {
      this.state = { ...this.state, status: "canceled" };
    } else if (action === "next") {
      const category = this.state.lastFailure?.category;
      const strategy = category ? this.planner.next(category, this.state.attemptedStrategies) : undefined;
      this.state = strategy
        ? {
            ...this.state,
            status: "recovering",
            currentStrategy: strategy,
            attemptedStrategies: [...this.state.attemptedStrategies, strategy],
          }
        : { ...this.state, status: "paused" };
      if (!strategy) {
        throw new Error("no remaining recovery strategy");
      }
    } else {
      // retry: reuse currentStrategy without consuming another budget slot
      this.state = { ...this.state, status: "recovering" };
    }
    return this.getRecoveryState();
  }
}
