import * as fs from "fs/promises";
import { existsSync, mkdirSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, rmSync } from "fs";
import Database from "better-sqlite3";
import * as path from "path";
import { randomUUID } from "node:crypto";

export type SessionTaskKind = "loop";
export type SessionTaskMode = "fixed" | "default";
export type SessionTaskStatus = "active" | "running" | "blocked" | "failed" | "completed" | "canceled";
export type SessionTaskRunner = "session" | "daemon";

/** 一次执行尝试的所有权记录；状态字段本身不再代表执行资格。 */
export interface SessionTaskAttempt {
  id: string;
  ownerId: string;
  claimedAt: number;
}

export interface SessionTask {
  id: string;
  kind: SessionTaskKind;
  prompt: string;
  intervalMs: number;
  mode: SessionTaskMode;
  runner: SessionTaskRunner;
  status: SessionTaskStatus;
  pending: boolean;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  nextRunAt: number;
  attemptCount?: number;
  consecutiveFailures?: number;
  lastError?: { message: string; timestamp: number };
  backoffUntil?: number;
  attempt?: SessionTaskAttempt;
}

export interface SessionSchedulerOptions {
  stateDir: string;
  sessionId: string;
  onDue?: (task: SessionTask) => Promise<void>;
  clock?: () => number;
  pollIntervalMs?: number;
  runner?: SessionTaskRunner;
  /** 实例唯一标识；默认 pid + randomUUID，用于区分同机多个 scheduler。 */
  instanceId?: string;
  /** running attempt 的租约；超过后进入 blocked 并等待显式 reconcile，不自动重放。 */
  claimLeaseMs?: number;
}

export interface DueRunResult {
  triggered: number;
}

function cloneTask(task: SessionTask): SessionTask {
  return { ...task, ...(task.attempt ? { attempt: { ...task.attempt } } : {}) };
}

export class SessionScheduler {
  private readonly tasksDir: string;
  private readonly stateFile: string;
  private readonly claimDir: string;
  private readonly onDue: (task: SessionTask) => Promise<void>;
  private readonly clock: () => number;
  private readonly pollIntervalMs: number;
  private readonly runner: SessionTaskRunner;
  private readonly ownerId: string;
  private readonly claimLeaseMs?: number;
  private readonly tasks = new Map<string, SessionTask>();
  private readonly inFlight = new Set<string>();
  private busy = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: SessionSchedulerOptions) {
    this.tasksDir = path.join(options.stateDir, "session-tasks");
    this.stateFile = path.join(this.tasksDir, `${options.sessionId}.json`);
    this.claimDir = path.join(this.tasksDir, "claims");
    this.onDue = options.onDue ?? (async () => {});
    this.clock = options.clock ?? (() => Date.now());
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.runner = options.runner ?? "session";
    this.ownerId = options.instanceId ?? `${process.pid}:${randomUUID()}`;
    this.claimLeaseMs = options.claimLeaseMs;
  }

  async init(): Promise<void> {
    await fs.mkdir(this.tasksDir, { recursive: true });
    await this.loadTasks();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runDueTasksOnce();
    }, this.pollIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  setBusy(value: boolean): void {
    this.busy = value;
  }

  async createLoopTask(options: {
    prompt: string;
    intervalMs: number;
    mode: SessionTaskMode;
    runner?: SessionTaskRunner;
  }): Promise<SessionTask> {
    return this.withTaskState(() => {
      const now = this.clock();
      const task: SessionTask = {
        id: `tsk_loop_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        kind: "loop",
        prompt: options.prompt,
        intervalMs: Math.max(1_000, Math.floor(options.intervalMs)),
        mode: options.mode,
        runner: options.runner ?? this.runner,
        status: "active",
        pending: false,
        createdAt: now,
        updatedAt: now,
        nextRunAt: now + Math.max(1_000, Math.floor(options.intervalMs)),
      };
      this.tasks.set(task.id, task);
      this.saveTasks();
      return cloneTask(task);
    });
  }

  async listTasks(): Promise<SessionTask[]> {
    return this.withTaskState(() => Array.from(this.tasks.values())
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(cloneTask));
  }

  async cancelTask(id: string): Promise<SessionTask> {
    return this.withTaskState(() => {
      const task = this.getTaskOrThrow(id);
      task.status = "canceled";
      task.pending = false;
      task.attempt = undefined;
      task.updatedAt = this.clock();
      this.saveTasks();
      this.removeClaimFile(id);
      return cloneTask(task);
    });
  }

  async cancelAllTasks(): Promise<number> {
    return this.withTaskState(() => {
      let count = 0;
      const canceled: string[] = [];
      for (const task of this.tasks.values()) {
        if (task.status === "active" || task.status === "running" || task.status === "blocked") {
          task.status = "canceled";
          task.pending = false;
          task.attempt = undefined;
          task.updatedAt = this.clock();
          canceled.push(task.id);
          count++;
        }
      }
      if (count > 0) {
        this.saveTasks();
        for (const id of canceled) this.removeClaimFile(id);
      }
      return count;
    });
  }

  async runDueTasksOnce(): Promise<DueRunResult> {
    const ids = this.withTaskState(() => Array.from(this.tasks.values())
      .sort((a, b) => a.nextRunAt - b.nextRunAt).map((task) => task.id));
    let triggered = 0;
    for (const id of ids) {
      const task = this.withTaskState(() => this.prepareAttempt(id));
      if (!task?.attempt) continue;
      const attempt = task.attempt;
      let failed = false;
      let failure: unknown;
      try {
        // Never hold the state lock while user code or an Agent turn is running.
        await this.onDue(cloneTask(task));
        triggered++;
      } catch (error) {
        failed = true;
        failure = error;
      } finally {
        try {
          this.withTaskState(() => {
            const current = this.tasks.get(id);
            // The disk state, not the old callback's cached task, owns settlement.
            if (current?.status === "running" &&
                current.attempt?.id === attempt.id && current.attempt.ownerId === attempt.ownerId) {
              const now = this.clock();
              current.attempt = undefined;
              current.lastRunAt = task.updatedAt;
              current.updatedAt = now;
              if (failed) {
                const failures = (current.consecutiveFailures ?? 0) + 1;
                current.consecutiveFailures = failures;
                current.lastError = { message: sanitizeError(failure), timestamp: now };
                current.status = failures >= 4 ? "failed" : "active";
                current.backoffUntil = failures >= 4 ? undefined : now + Math.min(60_000, 1_000 * 2 ** (failures - 1));
                if (current.backoffUntil !== undefined) current.nextRunAt = current.backoffUntil;
              } else {
                current.status = "active";
                current.consecutiveFailures = 0;
                current.lastError = undefined;
                current.backoffUntil = undefined;
                current.nextRunAt = task.updatedAt + current.intervalMs;
              }
              this.saveTasks();
            }
            this.releaseClaim(id, attempt.id);
          });
        } finally {
          this.inFlight.delete(id);
        }
      }
    }
    return { triggered };
  }

  /** Runs only inside withTaskState; no await may split claim and state publication. */
  private prepareAttempt(id: string): SessionTask | null {
    const task = this.tasks.get(id);
    if (!task || ["canceled", "completed", "failed", "blocked"].includes(task.status) ||
        (task.runner ?? "session") !== this.runner) return null;
    const now = this.clock();
    if (task.status === "running") {
      if (this.inFlight.has(id)) return null;
      if (now - (task.attempt?.claimedAt ?? task.updatedAt) < this.leaseFor(task)) return null;
      this.blockTask(task, now);
      return null;
    }
    if (!(task.pending || (task.nextRunAt <= now && (task.backoffUntil ?? 0) <= now))) return null;
    if (this.busy) {
      if (!task.pending) {
        task.pending = true;
        task.updatedAt = now;
        this.saveTasks();
      }
      return null;
    }
    const attemptId = `att_${now.toString(36)}_${randomUUID().slice(0, 8)}`;
    if (!this.acquireClaim(id, attemptId, now)) {
      const existing = this.readClaim(id);
      // An incomplete or expired claim is uncertain, never permission to steal it.
      if (!existing || now - existing.claimedAt >= this.leaseFor(task)) this.blockTask(task, now);
      return null;
    }
    task.pending = false;
    task.status = "running";
    task.attempt = { id: attemptId, ownerId: this.ownerId, claimedAt: now };
    task.attemptCount = (task.attemptCount ?? 0) + 1;
    task.updatedAt = now;
    try {
      this.saveTasks();
    } catch (error) {
      this.releaseClaim(id, attemptId);
      throw error;
    }
    this.inFlight.add(id);
    return cloneTask(task);
  }

  private blockTask(task: SessionTask, now: number): void {
    task.status = "blocked";
    task.pending = false;
    task.lastError = {
      message: `uncertain running attempt (${task.attempt?.id ?? "unknown"}) requires explicit reconcile`,
      timestamp: now,
    };
    task.attempt = undefined;
    task.updatedAt = now;
    // Keep the claim as evidence until explicit reconciliation or cancellation.
    this.saveTasks();
  }

  /**
   * 显式恢复一个因过期 attempt 而 blocked 的任务。
   * 只有调用方确认旧执行已结束（或副作用可接受）后才应调用；调度器不会自动重放。
   */
  async reconcileTask(id: string): Promise<SessionTask> {
    return this.withTaskState(() => {
      const task = this.getTaskOrThrow(id);
      if (task.status !== "blocked") throw new Error(`session task is not blocked: ${id}`);
      const now = this.clock();
      task.status = "active";
      task.pending = false;
      task.attempt = undefined;
      task.lastError = undefined;
      task.backoffUntil = undefined;
      task.nextRunAt = now;
      task.updatedAt = now;
      this.saveTasks();
      this.removeClaimFile(id);
      return cloneTask(task);
    });
  }

  private leaseFor(task: SessionTask): number {
    return this.claimLeaseMs ?? Math.max(60_000, Math.max(1_000, task.intervalMs) * 2);
  }

  private claimFile(taskId: string): string {
    const safe = taskId.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "task";
    return path.join(this.claimDir, `${safe}.claim`);
  }

  /** Atomic claim publication, called only while holding the session state lock. */
  private acquireClaim(taskId: string, attemptId: string, now: number): boolean {
    mkdirSync(this.claimDir, { recursive: true });
    let fd: number;
    try {
      fd = openSync(this.claimFile(taskId), "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
    try {
      writeFileSync(fd, JSON.stringify({ taskId, attemptId, ownerId: this.ownerId, claimedAt: now }), "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    return true;
  }

  private releaseClaim(taskId: string, attemptId: string): void {
    // Missing/unreadable is not proof that this attempt still owns the file.
    if (this.readClaim(taskId)?.attemptId === attemptId) this.removeClaimFile(taskId);
  }

  private readClaim(taskId: string): { attemptId: string; ownerId: string; claimedAt: number } | null {
    try {
      const parsed = JSON.parse(readFileSync(this.claimFile(taskId), "utf8")) as Record<string, unknown>;
      if (typeof parsed.attemptId !== "string" || typeof parsed.ownerId !== "string" ||
          typeof parsed.claimedAt !== "number" || !Number.isFinite(parsed.claimedAt)) return null;
      return { attemptId: parsed.attemptId, ownerId: parsed.ownerId, claimedAt: parsed.claimedAt };
    } catch {
      return null;
    }
  }

  private removeClaimFile(taskId: string): void {
    rmSync(this.claimFile(taskId), { force: true });
  }

  /**
   * SQLite supplies a crash-released, cross-process mutex for short JSON read/modify/write
   * sections. It stores no task data. All participants reload under the same lock;
   * callbacks run outside it. Synchronous I/O prevents same-process lock waits from
   * blocking a lock holder paused at an await. JSON remains the task format.
   */
  private withTaskState<T>(action: () => T): T {
    mkdirSync(this.tasksDir, { recursive: true });
    const db = new Database(`${this.stateFile}.coord.sqlite`, { timeout: 5_000 });
    try {
      return db.transaction(() => {
        this.loadTasks();
        return action();
      }).immediate();
    } finally {
      db.close();
    }
  }

  private getTaskOrThrow(id: string): SessionTask {
    const task = this.tasks.get(id);
    if (!task) {
      throw new Error(`session task not found: ${id}`);
    }
    return task;
  }

  private loadTasks(): void {
    this.tasks.clear();
    if (!existsSync(this.stateFile)) return;
    const parsed = JSON.parse(readFileSync(this.stateFile, "utf8")) as SessionTask[];
    for (const task of parsed) this.tasks.set(task.id, { ...task, runner: task.runner ?? "session" });
  }

  private saveTasks(): void {
    const payload = Array.from(this.tasks.values()).sort((a, b) => a.createdAt - b.createdAt).map(cloneTask);
    const tempFile = `${this.stateFile}.${process.pid}.${randomUUID()}.tmp`;
    try {
      const fd = openSync(tempFile, "wx", 0o600);
      try {
        writeFileSync(fd, JSON.stringify(payload, null, 2), "utf8");
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(tempFile, this.stateFile);
    } finally {
      rmSync(tempFile, { force: true });
    }
  }

}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\b(?:sk|api)[-_][a-z0-9_-]{8,}\b/gi, "[redacted]").slice(0, 500);
}
