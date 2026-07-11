import type { ExecutionEvent, ExecutionRunStatus } from "./types.js";

type ExecutionListener = (event: ExecutionEvent) => void;

export class ExecutionEventBus {
  private readonly listeners = new Set<ExecutionListener>();
  private readonly startedRuns = new Set<string>();
  private readonly terminalRuns = new Set<string>();
  private readonly activeAttemptByRun = new Map<string, string>();
  private readonly terminalAttempts = new Set<string>();
  private readonly terminalTools = new Set<string>();
  private readonly runSessions = new Map<string, string>();
  private readonly now: () => number;
  private sequence = 0;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  subscribe(listener: ExecutionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  startRun(input: { runId: string; sessionId: string }): ExecutionEvent | undefined {
    if (this.startedRuns.has(input.runId)) return undefined;
    this.startedRuns.add(input.runId);
    this.runSessions.set(input.runId, input.sessionId);
    return this.emit({
      runId: input.runId,
      sessionId: input.sessionId,
      type: "run_started",
      status: "running",
    });
  }

  completeRun(runId: string, status: Extract<ExecutionRunStatus, "succeeded" | "failed" | "canceled">): ExecutionEvent | undefined {
    if (!this.startedRuns.has(runId) || this.terminalRuns.has(runId)) return undefined;
    this.terminalRuns.add(runId);
    return this.emit({ runId, sessionId: this.runSessions.get(runId), type: "run_completed", status });
  }

  startAttempt(input: { runId: string; sessionId: string; attemptId: string }): ExecutionEvent {
    this.activeAttemptByRun.set(input.runId, input.attemptId);
    return this.emit({ ...input, type: "attempt_started", status: "running" });
  }

  completeAttempt(runId: string, status: Extract<ExecutionRunStatus, "succeeded" | "failed" | "canceled" | "recovering">): ExecutionEvent | undefined {
    const attemptId = this.activeAttemptByRun.get(runId);
    if (!attemptId || this.terminalAttempts.has(attemptId)) return undefined;
    this.terminalAttempts.add(attemptId);
    this.activeAttemptByRun.delete(runId);
    return this.emit({ runId, sessionId: this.runSessions.get(runId), attemptId, type: "attempt_completed", status });
  }

  startTool(input: { runId: string; attemptId: string; toolCallId: string; tool: string }): ExecutionEvent {
    return this.emit({ ...input, sessionId: this.runSessions.get(input.runId), type: "tool_started", status: "running", stage: "tool" });
  }

  completeTool(input: { runId: string; attemptId: string; toolCallId: string; tool: string; failed?: boolean }): ExecutionEvent | undefined {
    if (this.terminalTools.has(input.toolCallId)) return undefined;
    this.terminalTools.add(input.toolCallId);
    return this.emit({
      runId: input.runId,
      sessionId: this.runSessions.get(input.runId),
      attemptId: input.attemptId,
      toolCallId: input.toolCallId,
      tool: input.tool,
      type: "tool_completed",
      status: input.failed ? "failed" : "succeeded",
      stage: "tool",
    });
  }

  emit(event: Omit<ExecutionEvent, "eventId" | "timestamp"> & Partial<Pick<ExecutionEvent, "eventId" | "timestamp">>): ExecutionEvent {
    const completeEvent: ExecutionEvent = {
      ...event,
      eventId: event.eventId ?? `evt_${this.now().toString(36)}_${(++this.sequence).toString(36)}`,
      timestamp: event.timestamp ?? this.now(),
    };
    for (const listener of this.listeners) listener(completeEvent);
    return completeEvent;
  }
}
