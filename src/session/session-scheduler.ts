import * as fs from "fs/promises";
import { existsSync } from "fs";
import * as path from "path";
import { randomUUID } from "node:crypto";

export type SessionTaskKind = "loop";
export type SessionTaskMode = "fixed" | "default";
export type SessionTaskStatus = "active" | "running" | "blocked" | "failed" | "completed" | "canceled";
export type SessionTaskRunner = "session" | "daemon";

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
}

export interface SessionSchedulerOptions {
  stateDir: string;
  sessionId: string;
  onDue?: (task: SessionTask) => Promise<void>;
  clock?: () => number;
  pollIntervalMs?: number;
  runner?: SessionTaskRunner;
}

export interface DueRunResult {
  triggered: number;
}

function cloneTask(task: SessionTask): SessionTask {
  return { ...task };
}

export class SessionScheduler {
  private readonly tasksDir: string;
  private readonly stateFile: string;
  private readonly onDue: (task: SessionTask) => Promise<void>;
  private readonly clock: () => number;
  private readonly pollIntervalMs: number;
  private readonly runner: SessionTaskRunner;
  private readonly tasks = new Map<string, SessionTask>();
  private busy = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: SessionSchedulerOptions) {
    this.tasksDir = path.join(options.stateDir, "session-tasks");
    this.stateFile = path.join(this.tasksDir, `${options.sessionId}.json`);
    this.onDue = options.onDue ?? (async () => {});
    this.clock = options.clock ?? (() => Date.now());
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.runner = options.runner ?? "session";
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
    await this.loadTasks();
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
    await this.saveTasks();
    return cloneTask(task);
  }

  async listTasks(): Promise<SessionTask[]> {
    await this.loadTasks();
    return Array.from(this.tasks.values())
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(cloneTask);
  }

  async cancelTask(id: string): Promise<SessionTask> {
    await this.loadTasks();
    const task = this.getTaskOrThrow(id);
    task.status = "canceled";
    task.pending = false;
    task.updatedAt = this.clock();
    await this.saveTasks();
    return cloneTask(task);
  }

  async cancelAllTasks(): Promise<number> {
    await this.loadTasks();
    let count = 0;
    for (const task of this.tasks.values()) {
      if (task.status === "active" || task.status === "running") {
        task.status = "canceled";
        task.pending = false;
        task.updatedAt = this.clock();
        count++;
      }
    }
    if (count > 0) {
      await this.saveTasks();
    }
    return count;
  }

  async runDueTasksOnce(): Promise<DueRunResult> {
    await this.loadTasks();
    const now = this.clock();
    let triggered = 0;
    let dirty = false;
    const tasks = Array.from(this.tasks.values()).sort((a, b) => a.nextRunAt - b.nextRunAt);

    for (const task of tasks) {
      if (["canceled", "completed", "failed", "blocked"].includes(task.status)) {
        continue;
      }
      if ((task.runner ?? "session") !== this.runner) {
        continue;
      }
      const isDue = task.pending || (task.nextRunAt <= now && (task.backoffUntil ?? 0) <= now);
      if (!isDue) continue;

      if (this.busy) {
        if (!task.pending) {
          task.pending = true;
          task.updatedAt = now;
          dirty = true;
        }
        continue;
      }

      task.pending = false;
      task.status = "running";
      task.attemptCount = (task.attemptCount ?? 0) + 1;
      task.updatedAt = now;
      await this.saveTasks();

      try {
        await this.onDue(cloneTask(task));
        triggered++;
        const currentTask = this.tasks.get(task.id);
        if (currentTask && currentTask.status !== "canceled") {
          currentTask.status = "active";
          currentTask.consecutiveFailures = 0;
          currentTask.lastError = undefined;
          currentTask.backoffUntil = undefined;
          currentTask.lastRunAt = now;
          currentTask.nextRunAt = now + currentTask.intervalMs;
          currentTask.updatedAt = this.clock();
        }
      } catch (error) {
        const currentTask = this.tasks.get(task.id);
        if (currentTask && currentTask.status !== "canceled") {
          const failures = (currentTask.consecutiveFailures ?? 0) + 1;
          const failedAt = this.clock();
          currentTask.consecutiveFailures = failures;
          currentTask.lastError = { message: sanitizeError(error), timestamp: failedAt };
          currentTask.lastRunAt = now;
          currentTask.updatedAt = failedAt;
          if (failures >= 4) {
            currentTask.status = "failed";
            currentTask.backoffUntil = undefined;
          } else {
            const delay = Math.min(60_000, 1_000 * 2 ** (failures - 1));
            currentTask.status = "active";
            currentTask.backoffUntil = failedAt + delay;
            currentTask.nextRunAt = currentTask.backoffUntil;
          }
        }
      } finally {
        await this.saveTasks();
      }
    }

    if (dirty) {
      await this.saveTasks();
    }

    return { triggered };
  }

  private getTaskOrThrow(id: string): SessionTask {
    const task = this.tasks.get(id);
    if (!task) {
      throw new Error(`session task not found: ${id}`);
    }
    return task;
  }

  private async loadTasks(): Promise<void> {
    if (!existsSync(this.stateFile)) return;
    const raw = await fs.readFile(this.stateFile, "utf-8");
    const parsed = JSON.parse(raw) as SessionTask[];
    this.tasks.clear();
    for (const task of parsed) {
      this.tasks.set(task.id, {
        ...task,
        runner: task.runner ?? "session",
      });
    }
  }

  private async saveTasks(): Promise<void> {
    const payload = Array.from(this.tasks.values())
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(cloneTask);
    const tempFile = `${this.stateFile}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify(payload, null, 2), "utf-8");
    try {
      await fs.rename(tempFile, this.stateFile);
    } finally {
      await fs.rm(tempFile, { force: true }).catch(() => undefined);
    }
  }
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\b(?:sk|api)[-_][a-z0-9_-]{8,}\b/gi, "[redacted]").slice(0, 500);
}
