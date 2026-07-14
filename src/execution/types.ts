export type ExecutionRunStatus =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "recovering"
  | "paused"
  | "succeeded"
  | "failed"
  | "canceled";

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
}

export interface FailureClassification {
  category: FailureCategory;
  message: string;
  tool?: string;
  targetPath?: string;
  verificationCommand?: string;
  fingerprint?: string;
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
  status?: ExecutionRunStatus;
  tool?: string;
  category?: FailureCategory;
  fingerprint?: string;
  durationMs?: number;
  progress?: ProgressSnapshot;
  recoveryAction?: string;
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
