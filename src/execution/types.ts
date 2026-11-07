export type ExecutionRunStatus =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "recovering"
  | "paused"
  | "exhausted"
  | "succeeded"
  | "failed"
  | "canceled"
  | "interrupted";

export type FailureCategory =
  | "provider_transient"
  | "provider_terminal"
  | "invalid_tool_arguments"
  | "permission_required"
  | "permission_denied"
  | "sandbox_denied"
  | "tool_not_found"
  | "tool_execution"
  | "verification_failed"
  | "context_exhausted"
  | "repeated_action"
  | "no_progress"
  | "user_canceled";

export interface ProgressSnapshot {
  diffHash?: string;
  failingTests?: string[];
  completedTodos?: number;
  changed?: boolean;
  /** Basename-only list of modified paths (no full workspace leak). */
  changedFiles?: string[];
  /** Recovery strategies already attempted when this snapshot was recorded. */
  attemptedStrategies?: string[];
  currentStrategy?: string;
}

export interface FailureClassification {
  category: FailureCategory;
  message: string;
  tool?: string;
  targetPath?: string;
  verificationCommand?: string;
  fingerprint?: string;
}

export type TaskCompletionStatus =
  | "completed_verified"
  | "completed_unverified"
  | "partially_completed"
  | "incomplete"
  | "failed"
  | "unknown";

export type ExecutionStrategyTier =
  | "fast_path"
  | "light_plan"
  | "full_plan"
  | "high_risk";

export type DecisionStage =
  | "understand"
  | "gather"
  | "analyze"
  | "plan_decide"
  | "act"
  | "observe"
  | "verify"
  | "update_replan"
  | "finish";

export interface DecisionRecord {
  turn: number;
  stage: DecisionStage;
  strategy: ExecutionStrategyTier;
  goal: string;
  knownFacts: string[];
  constraints: string[];
  selectedAction: string;
  rationaleSummary: string;
  expectedOutcome: string;
  actualOutcome: string;
  verificationStatus: "unverified" | "pass" | "fail" | "partial" | "skipped";
  nextStep: "continue" | "verify" | "replan" | "switch_strategy" | "request_user_input" | "finish" | "pause";
  timestamp: number;
}

export interface ExecutionEvent {
  eventId: string;
  runId: string;
  sessionId?: string;
  attemptId?: string;
  toolCallId?: string;
  type: string;
  timestamp: number;
  stage?: string;
  decisionStage?: DecisionStage;
  strategyTier?: ExecutionStrategyTier;
  completionStatus?: TaskCompletionStatus;
  status?: ExecutionRunStatus;
  tool?: string;
  /** Workspace-relative target for file tools; absolute paths are never emitted. */
  toolTarget?: string;
  category?: FailureCategory;
  fingerprint?: string;
  durationMs?: number;
  progress?: ProgressSnapshot;
  recoveryAction?: string;
  /** The tool call was not executed because a runtime policy redirected it. */
  policyRedirect?: boolean;
  /** Model retry telemetry. Never includes keys, Authorization, or request bodies. */
  modelRetry?: {
    attempt?: number;
    max?: number;
    delayMs?: number;
    kind?: string;
    status?: number;
    requestId?: string;
    model?: string;
    attempts?: number;
    elapsedMs?: number;
    lastKind?: string;
    models?: string[];
    from?: string;
    to?: string;
  };
}

export interface RecoveryDecision {
  action: "recover" | "pause" | "fail";
  category?: FailureCategory;
  reason: string;
  remainingStrategyAttempts: number;
  recommendedStrategy?: string;
}

export interface RecoveryState {
  runId: string;
  sessionId: string;
  originalTask: string;
  status: "running" | "recovering" | "paused" | "failed" | "canceled";
  strategyAttempts: number;
  remainingStrategyAttempts: number;
  currentStrategy?: string;
  attemptedStrategies: string[];
  lastFailure?: FailureClassification;
  lastProgress?: ProgressSnapshot;
}

export type RunOutcome =
  | {
      status: "succeeded";
      runId: string;
      text: string;
      completionStatus?: TaskCompletionStatus;
      strategyTier?: ExecutionStrategyTier;
      decisionLedger?: DecisionRecord[];
      verificationEvidence?: string[];
    }
  | {
      status: "paused";
      runId: string;
      text: string;
      recovery: RecoveryState | null;
      completionStatus?: TaskCompletionStatus;
      strategyTier?: ExecutionStrategyTier;
      decisionLedger?: DecisionRecord[];
    }
  | {
      status: "exhausted";
      runId: string;
      text: string;
      iterations: number;
      completionStatus?: TaskCompletionStatus;
      strategyTier?: ExecutionStrategyTier;
      decisionLedger?: DecisionRecord[];
    }
  | {
      status: "failed";
      runId: string;
      text: string;
      failure: FailureClassification;
      completionStatus?: TaskCompletionStatus;
      strategyTier?: ExecutionStrategyTier;
      decisionLedger?: DecisionRecord[];
    }
  | {
      status: "canceled";
      runId: string;
      text: string;
      reason: string;
      completionStatus?: TaskCompletionStatus;
      strategyTier?: ExecutionStrategyTier;
      decisionLedger?: DecisionRecord[];
    };
