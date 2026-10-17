export type SessionState =
  | "initializing"
  | "idle"
  | "queued"
  | "running"
  | "waiting_approval"
  | "compacting"
  | "verifying"
  | "recovering"
  | "paused"
  | "completed"
  | "failed"
  | "canceled"
  | "closing";

export type SessionCommand =
  | { type: "submit_prompt"; prompt: string }
  | { type: "interject"; prompt: string }
  | { type: "approve"; requestId: string; decision: "allow" | "deny" }
  | { type: "cancel_turn"; reason?: string }
  | { type: "pause_session"; reason?: string }
  | { type: "resume_session" }
  | { type: "resize_ui"; columns: number; rows: number }
  | { type: "shutdown" };

export interface SessionEventEnvelope<T extends JsonValue = JsonValue> {
  eventId: string;
  sequence: number;
  sessionId: string;
  runId?: string;
  turnId?: string;
  causationId?: string;
  type: string;
  timestamp: number;
  payload: T;
  checksum: string;
}

export interface SessionBudgetSnapshot {
  wallClockMs?: number;
  tokenLimit?: number;
  tokensUsed?: number;
  toolCallLimit?: number;
  toolCallsUsed?: number;
  failureLimit?: number;
  failuresUsed?: number;
}

export interface SessionSnapshot {
  sessionId: string;
  state: SessionState;
  sequence: number;
  promptQueue: Array<{
    id: string;
    prompt: string;
    priority: "normal" | "interjection";
    queuedAt: number;
  }>;
  activeRun: { runId: string; turnId: string; prompt: string; startedAt: number } | null;
  pendingApproval: { requestId: string; toolName?: string; reason?: string } | null;
  activeTools: Array<{ toolCallId: string; tool: string; startedAt: number }>;
  recentEvidence: string[];
  budget: SessionBudgetSnapshot;
  viewport?: { columns: number; rows: number };
  pauseReason?: string;
  updatedAt: number;
}

export type ToolSideEffect = "none" | "workspace" | "process" | "network" | "external";

export interface RuntimeToolCallRecord {
  toolCallId: string;
  tool: string;
  argumentsHash: string;
  sideEffect: ToolSideEffect;
  idempotent: boolean;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled" | "unknown_outcome";
  startedAt?: number;
  completedAt?: number;
}

export interface PromptExecutionResult {
  status: "completed" | "paused" | "failed" | "canceled";
  text: string;
}
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
