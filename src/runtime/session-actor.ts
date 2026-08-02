import { randomUUID } from "node:crypto";
import type { RuntimeEventJournal } from "./event-journal.js";
import type {
  JsonValue,
  PromptExecutionResult,
  SessionCommand,
  SessionSnapshot,
  SessionState,
} from "./types.js";

interface PromptQueueItem {
  id: string;
  prompt: string;
  priority: "normal" | "interjection";
  queuedAt: number;
  resolve: (result: PromptExecutionResult) => void;
  reject: (error: unknown) => void;
}

export interface SessionActorOptions {
  sessionId: string;
  journal: RuntimeEventJournal;
  now?: () => number;
  executePrompt: (input: {
    prompt: string;
    priority: "normal" | "interjection";
    runId: string;
    turnId: string;
    signal: AbortSignal;
  }) => Promise<PromptExecutionResult>;
  initialSnapshot?: SessionSnapshot;
  snapshotEveryEvents?: number;
}

export class SessionActor {
  private readonly sessionId: string;
  private readonly journal: RuntimeEventJournal;
  private readonly executePrompt: SessionActorOptions["executePrompt"];
  private readonly now: () => number;
  private readonly snapshotEveryEvents: number;
  private readonly queue: PromptQueueItem[] = [];
  private snapshot: SessionSnapshot;
  private draining = false;
  private drainPromise: Promise<void> | null = null;
  private closed = false;
  private closePromise: Promise<void> | null = null;
  private activeAbort: AbortController | null = null;
  private activeItem: PromptQueueItem | null = null;
  private reservedHeadId: string | null = null;
  private eventsSinceSnapshot = 0;

  constructor(options: SessionActorOptions) {
    this.sessionId = options.sessionId;
    this.journal = options.journal;
    this.executePrompt = options.executePrompt;
    this.now = options.now ?? (() => Date.now());
    this.snapshotEveryEvents = Math.max(1, options.snapshotEveryEvents ?? 20);
    this.snapshot = options.initialSnapshot
      ? structuredClone(options.initialSnapshot)
      : {
          sessionId: options.sessionId,
          state: "idle",
          sequence: 0,
          promptQueue: [],
          activeRun: null,
          pendingApproval: null,
          activeTools: [],
          recentEvidence: [],
          budget: {},
          updatedAt: this.now(),
        };
    for (const recovered of this.snapshot.promptQueue) {
      this.queue.push({
        ...recovered,
        resolve: () => undefined,
        reject: () => undefined,
      });
    }
    if (this.snapshot.state === "queued" && this.queue.length > 0) {
      queueMicrotask(() => this.startDrain());
    }
  }

  getSnapshot(): SessionSnapshot {
    return structuredClone(this.snapshot);
  }

  dispatch(command: SessionCommand): Promise<PromptExecutionResult | void> {
    if (this.closed && command.type !== "shutdown") {
      return Promise.reject(new Error("session actor is closed"));
    }
    if (command.type === "submit_prompt" || command.type === "interject") {
      return this.enqueuePrompt(command.prompt, command.type === "interject" ? "interjection" : "normal");
    }
    if (command.type === "shutdown") return this.close();
    return this.handleControl(command);
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closePromise = (async () => {
      this.closed = true;
      this.activeAbort?.abort("session_shutdown");
      for (const item of this.queue.splice(0)) {
        item.resolve({ status: "canceled", text: "session shutdown" });
      }
      this.syncQueueSnapshot();
      await this.record("session_shutdown_requested", {});
      await this.drainPromise;
      await this.transition("closing", "session_closing", {});
      await this.maybeSaveSnapshot(true);
    })();
    return this.closePromise;
  }

  async waitForIdle(): Promise<void> {
    await this.drainPromise;
  }

  private enqueuePrompt(
    prompt: string,
    priority: "normal" | "interjection"
  ): Promise<PromptExecutionResult> {
    const normalized = prompt.trim();
    if (!normalized) return Promise.reject(new Error("prompt must not be empty"));
    return new Promise((resolve, reject) => {
      const item: PromptQueueItem = {
        id: `prompt_${randomUUID()}`,
        prompt: normalized,
        priority,
        queuedAt: this.now(),
        resolve,
        reject,
      };
      if (priority === "interjection") {
        const reservedIndex = this.reservedHeadId
          ? this.queue.findIndex((queued) => queued.id === this.reservedHeadId)
          : -1;
        const searchFrom = reservedIndex >= 0 ? reservedIndex + 1 : 0;
        const relativeNormal = this.queue
          .slice(searchFrom)
          .findIndex((queued) => queued.priority === "normal");
        const firstNormal = relativeNormal < 0 ? -1 : searchFrom + relativeNormal;
        if (firstNormal === -1) this.queue.push(item);
        else this.queue.splice(firstNormal, 0, item);
      } else {
        this.queue.push(item);
      }
      if (!this.draining && !this.reservedHeadId && this.snapshot.state !== "paused") {
        this.reservedHeadId = item.id;
      }
      this.syncQueueSnapshot();
      void this.record("prompt_queued", {
          promptId: item.id,
          prompt: item.prompt,
          priority,
          pendingCount: this.queue.length,
        })
        .then(() => {
          if (!this.draining && this.reservedHeadId === item.id) this.startDrain();
        })
        .catch((error) => {
          const index = this.queue.findIndex((queued) => queued.id === item.id);
          if (index >= 0) this.queue.splice(index, 1);
          if (this.reservedHeadId === item.id) {
            this.reservedHeadId = this.queue[0]?.id ?? null;
          }
          this.syncQueueSnapshot();
          item.reject(error);
        });
    });
  }

  private startDrain(): void {
    if (this.drainPromise || this.closed) return;
    this.reservedHeadId = null;
    this.drainPromise = this.drain()
      .catch((error) => {
        this.snapshot.state = "failed";
        this.snapshot.updatedAt = this.now();
        this.activeItem?.reject(error);
        this.activeItem = null;
        for (const queued of this.queue.splice(0)) queued.reject(error);
        this.syncQueueSnapshot();
      })
      .finally(() => {
        this.drainPromise = null;
      });
  }

  private async drain(): Promise<void> {
    if (this.draining || this.closed) return;
    this.draining = true;
    try {
      while (this.queue.length > 0 && !this.closed) {
        if (["paused", "closing"].includes(this.snapshot.state)) break;
        const item = this.queue.shift();
        if (!item) continue;
        this.activeItem = item;
        this.syncQueueSnapshot();
        const runId = `run_${randomUUID()}`;
        const turnId = `turn_${randomUUID()}`;
        this.activeAbort = new AbortController();
        this.snapshot.activeRun = {
          runId,
          turnId,
          prompt: item.prompt,
          startedAt: this.now(),
        };
        await this.transition("running", "prompt_started", {
          promptId: item.id,
          priority: item.priority,
        }, runId, turnId);
        try {
          const result = await this.executePrompt({
            prompt: item.prompt,
            priority: item.priority,
            runId,
            turnId,
            signal: this.activeAbort.signal,
          });
          this.snapshot.activeRun = null;
          this.snapshot.state = result.status === "paused"
            ? "paused"
            : result.status === "failed"
              ? "failed"
              : result.status === "canceled"
                ? "canceled"
                : this.queue.length > 0 ? "queued" : "idle";
          await this.record("prompt_completed", { status: result.status }, runId, turnId);
          item.resolve(result);
          if (result.status === "paused") {
            await this.transition("paused", "session_paused", { reason: result.text }, runId, turnId);
          } else if (result.status === "failed") {
            await this.transition("failed", "run_failed", { reason: result.text }, runId, turnId);
          } else if (result.status === "canceled") {
            await this.transition("canceled", "run_canceled", { reason: result.text }, runId, turnId);
          }
        } catch (error) {
          const canceled = this.activeAbort.signal.aborted;
          const result: PromptExecutionResult = {
            status: canceled ? "canceled" : "failed",
            text: error instanceof Error ? error.message : String(error),
          };
          this.snapshot.activeRun = null;
          this.snapshot.state = canceled ? "canceled" : "failed";
          await this.record(canceled ? "prompt_canceled" : "prompt_failed", { message: result.text }, runId, turnId);
          item.resolve(result);
        } finally {
          this.activeItem = null;
          this.activeAbort = null;
          this.snapshot.activeRun = null;
          if (!["paused", "closing"].includes(this.snapshot.state)) {
            await this.transition(this.queue.length > 0 ? "queued" : "idle", "state_changed", {
              pendingCount: this.queue.length,
            });
          }
        }
      }
    } finally {
      this.draining = false;
      await this.maybeSaveSnapshot(true);
    }
  }

  private async handleControl(command: Exclude<SessionCommand, { type: "submit_prompt" | "interject" | "shutdown" }>): Promise<void> {
    switch (command.type) {
      case "cancel_turn":
        this.activeAbort?.abort(command.reason ?? "user_canceled");
        await this.record("turn_cancel_requested", { reason: command.reason ?? "user_canceled" });
        return;
      case "pause_session":
        this.snapshot.pauseReason = command.reason ?? "user_paused";
        await this.transition("paused", "session_paused", { reason: this.snapshot.pauseReason });
        return;
      case "resume_session":
        this.snapshot.pauseReason = undefined;
        await this.transition(this.queue.length > 0 ? "queued" : "idle", "session_resumed", {});
        if (!this.draining) this.startDrain();
        return;
      case "approve":
        if (this.snapshot.pendingApproval?.requestId === command.requestId) {
          this.snapshot.pendingApproval = null;
        }
        await this.record("approval_decided", command);
        return;
      case "resize_ui":
        this.snapshot.viewport = { columns: command.columns, rows: command.rows };
        this.snapshot.updatedAt = this.now();
        await this.record("ui_resized", this.snapshot.viewport);
        return;
    }
  }

  private async transition(
    state: SessionState,
    eventType: string,
    payload: JsonValue,
    runId?: string,
    turnId?: string
  ): Promise<void> {
    this.snapshot.state = state;
    this.snapshot.updatedAt = this.now();
    await this.record(eventType, { state, payload }, runId, turnId);
  }

  private async record(type: string, payload: JsonValue, runId?: string, turnId?: string): Promise<void> {
    const event = await this.journal.append({ type, payload, runId, turnId });
    this.snapshot.sequence = event.sequence;
    this.snapshot.updatedAt = event.timestamp;
    this.eventsSinceSnapshot++;
    await this.maybeSaveSnapshot(false);
  }

  private syncQueueSnapshot(): void {
    this.snapshot.promptQueue = this.queue.map(({ id, prompt, priority, queuedAt }) => ({
      id,
      prompt,
      priority,
      queuedAt,
    }));
    if (!this.snapshot.activeRun && this.queue.length > 0 && this.snapshot.state === "idle") {
      this.snapshot.state = "queued";
    }
  }

  private async maybeSaveSnapshot(force: boolean): Promise<void> {
    if (!force && this.eventsSinceSnapshot < this.snapshotEveryEvents) return;
    await this.journal.saveSnapshot(this.snapshot);
    this.eventsSinceSnapshot = 0;
  }
}
