// ============================================================
// G3.2 — 统一后台任务注册表（shell bg · task_id · list/wait/kill）
// 进程内；不替代 mission / session loop，仅统一可观察的 task_id 面。
// ============================================================

import { spawn, execFileSync, type ChildProcess } from "child_process";
import { EventEmitter } from "node:events";

export type BgTaskKind = "shell";
export type BgTaskStatus = "running" | "completed" | "failed" | "killed" | "timeout";

export interface BackgroundTask {
  taskId: string;
  kind: BgTaskKind;
  status: BgTaskStatus;
  command: string;
  cwd: string;
  pid?: number;
  createdAt: number;
  updatedAt: number;
  endedAt?: number;
  exitCode?: number | null;
  signal?: string | null;
  /** 截断后的合并输出 */
  output: string;
  error?: string;
  /** 启动时声明的最长存活（ms）；0 = 无上限（仍可 kill） */
  maxLifetimeMs: number;
}

export type BackgroundTaskEvent =
  | { type: "started"; task: BackgroundTask }
  | { type: "updated"; task: BackgroundTask }
  | { type: "finished"; task: BackgroundTask };

const MAX_TASKS_RETAINED = 50;
const MAX_OUTPUT_BYTES = 512 * 1024;
const DEFAULT_MAX_LIFETIME_MS = 30 * 60 * 1000; // 30 min
const MAX_CONCURRENT_RUNNING = 8;

function makeTaskId(): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `bg_${t}_${r}`;
}

function truncateBytes(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.byteLength <= maxBytes) return text;
  return buf.subarray(0, maxBytes).toString("utf8") + `\n[truncated at ${maxBytes} bytes]`;
}

export class BackgroundTaskRegistry extends EventEmitter {
  private readonly tasks = new Map<string, BackgroundTask>();
  private readonly procs = new Map<string, ChildProcess>();
  private readonly waiters = new Map<string, Array<(task: BackgroundTask) => void>>();

  list(options: { includeFinished?: boolean; limit?: number } = {}): BackgroundTask[] {
    const includeFinished = options.includeFinished !== false;
    const limit = Math.max(1, Math.min(100, options.limit ?? 40));
    const all = [...this.tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
    const filtered = includeFinished ? all : all.filter((t) => t.status === "running");
    return filtered.slice(0, limit).map((t) => ({ ...t }));
  }

  get(taskId: string): BackgroundTask | null {
    const t = this.tasks.get(taskId);
    return t ? { ...t } : null;
  }

  runningCount(): number {
    let n = 0;
    for (const t of this.tasks.values()) {
      if (t.status === "running") n += 1;
    }
    return n;
  }

  /**
   * 启动 shell 后台任务。立即返回 task 快照；输出异步累积。
   */
  startShell(options: {
    command: string;
    cwd: string;
    env?: NodeJS.ProcessEnv;
    /** 最长存活秒；默认 1800；0 表示不设定时 kill */
    timeoutSec?: number;
  }): BackgroundTask {
    const command = String(options.command ?? "").trim();
    if (!command) {
      throw new Error("command is required");
    }
    if (this.runningCount() >= MAX_CONCURRENT_RUNNING) {
      throw new Error(`too many background tasks (max ${MAX_CONCURRENT_RUNNING} running)`);
    }

    const timeoutSec = options.timeoutSec;
    const maxLifetimeMs =
      timeoutSec === 0
        ? 0
        : Math.max(
            1_000,
            Math.min(
              24 * 60 * 60 * 1000,
              (typeof timeoutSec === "number" && Number.isFinite(timeoutSec)
                ? timeoutSec
                : DEFAULT_MAX_LIFETIME_MS / 1000) * 1000
            )
          );

    const taskId = makeTaskId();
    const now = Date.now();
    const task: BackgroundTask = {
      taskId,
      kind: "shell",
      status: "running",
      command,
      cwd: options.cwd,
      createdAt: now,
      updatedAt: now,
      output: "",
      maxLifetimeMs,
    };

    const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
    const shellArgs = process.platform === "win32" ? ["/c", command] : ["-c", command];
    const proc = spawn(shell, shellArgs, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    task.pid = proc.pid;
    this.tasks.set(taskId, task);
    this.procs.set(taskId, proc);
    this.trimHistory();
    this.emitEvent({ type: "started", task: { ...task } });

    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const append = (
      current: string,
      bytes: number,
      chunk: Buffer
    ): { text: string; bytes: number } => {
      if (bytes >= MAX_OUTPUT_BYTES) return { text: current, bytes };
      const remaining = MAX_OUTPUT_BYTES - bytes;
      if (chunk.byteLength <= remaining) {
        return { text: current + chunk.toString(), bytes: bytes + chunk.byteLength };
      }
      return {
        text: current + chunk.subarray(0, remaining).toString() + `\n[truncated at ${MAX_OUTPUT_BYTES} bytes]`,
        bytes: MAX_OUTPUT_BYTES,
      };
    };

    proc.stdout?.on("data", (chunk: Buffer) => {
      const next = append(stdout, stdoutBytes, chunk);
      stdout = next.text;
      stdoutBytes = next.bytes;
      this.patchOutput(taskId, stdout, stderr);
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      const next = append(stderr, stderrBytes, chunk);
      stderr = next.text;
      stderrBytes = next.bytes;
      this.patchOutput(taskId, stdout, stderr);
    });

    let lifeTimer: ReturnType<typeof setTimeout> | null = null;
    if (maxLifetimeMs > 0) {
      lifeTimer = setTimeout(() => {
        void this.kill(taskId, "timeout");
      }, maxLifetimeMs);
    }

    const finish = (status: BgTaskStatus, code: number | null, signal: string | null, error?: string) => {
      if (settled) return;
      settled = true;
      if (lifeTimer) clearTimeout(lifeTimer);
      this.procs.delete(taskId);
      const current = this.tasks.get(taskId);
      if (!current) return;
      current.status = status;
      current.exitCode = code;
      current.signal = signal;
      current.error = error;
      current.endedAt = Date.now();
      current.updatedAt = current.endedAt;
      current.output = this.mergeOutput(stdout, stderr);
      this.tasks.set(taskId, current);
      this.resolveWaiters(taskId, current);
      this.emitEvent({ type: "finished", task: { ...current } });
    };

    proc.on("close", (code, signal) => {
      if (settled) return;
      const status: BgTaskStatus = (code ?? 0) === 0 ? "completed" : "failed";
      finish(status, code, signal);
    });
    proc.on("error", (err) => {
      finish("failed", null, null, err.message);
    });

    return { ...task };
  }

  private mergeOutput(stdout: string, stderr: string): string {
    if (stderr.trim()) {
      return truncateBytes(`stdout:\n${stdout}\nstderr:\n${stderr}`, MAX_OUTPUT_BYTES);
    }
    return truncateBytes(stdout || "(no output)", MAX_OUTPUT_BYTES);
  }

  private patchOutput(taskId: string, stdout: string, stderr: string): void {
    const current = this.tasks.get(taskId);
    if (!current || current.status !== "running") return;
    current.output = this.mergeOutput(stdout, stderr);
    current.updatedAt = Date.now();
    this.tasks.set(taskId, current);
  }

  private resolveWaiters(taskId: string, task: BackgroundTask): void {
    const list = this.waiters.get(taskId);
    if (!list?.length) return;
    this.waiters.delete(taskId);
    for (const resolve of list) resolve({ ...task });
  }

  private emitEvent(event: BackgroundTaskEvent): void {
    this.emit("event", event);
  }

  private trimHistory(): void {
    if (this.tasks.size <= MAX_TASKS_RETAINED) return;
    const finished = [...this.tasks.values()]
      .filter((t) => t.status !== "running")
      .sort((a, b) => a.createdAt - b.createdAt);
    while (this.tasks.size > MAX_TASKS_RETAINED && finished.length) {
      const drop = finished.shift();
      if (drop) this.tasks.delete(drop.taskId);
    }
  }

  async wait(
    taskId: string,
    timeoutMs = 120_000
  ): Promise<BackgroundTask> {
    const current = this.tasks.get(taskId);
    if (!current) {
      throw new Error(`unknown task_id: ${taskId}`);
    }
    if (current.status !== "running") {
      return { ...current };
    }
    const ms = Math.max(0, Math.floor(timeoutMs));
    return new Promise<BackgroundTask>((resolve, reject) => {
      const onDone = (task: BackgroundTask) => {
        clearTimeout(timer);
        resolve(task);
      };
      const list = this.waiters.get(taskId) ?? [];
      list.push(onDone);
      this.waiters.set(taskId, list);
      const timer = setTimeout(() => {
        const arr = this.waiters.get(taskId);
        if (arr) {
          const idx = arr.indexOf(onDone);
          if (idx >= 0) arr.splice(idx, 1);
          if (!arr.length) this.waiters.delete(taskId);
        }
        const snap = this.tasks.get(taskId);
        if (snap && snap.status !== "running") {
          resolve({ ...snap });
          return;
        }
        reject(new Error(`wait timeout after ${ms}ms for ${taskId}`));
      }, ms);
    });
  }

  /**
   * 终止任务。reason=timeout 标记 status=timeout，否则 killed。
   */
  async kill(taskId: string, reason: "user" | "timeout" = "user"): Promise<BackgroundTask> {
    const current = this.tasks.get(taskId);
    if (!current) {
      throw new Error(`unknown task_id: ${taskId}`);
    }
    if (current.status !== "running") {
      return { ...current };
    }
    const proc = this.procs.get(taskId);
    if (proc?.pid) {
      try {
        if (process.platform === "win32") {
          execFileSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], {
            timeout: 5000,
            stdio: "ignore",
            windowsHide: true,
          });
        } else {
          proc.kill("SIGTERM");
          setTimeout(() => {
            try {
              if (!proc.killed) proc.kill("SIGKILL");
            } catch {
              // ignore
            }
          }, 1500);
        }
      } catch {
        try {
          proc.kill();
        } catch {
          // ignore
        }
      }
    }

    // close handler may race; force status if still running shortly
    await new Promise((r) => setTimeout(r, 50));
    const after = this.tasks.get(taskId);
    if (after && after.status === "running") {
      after.status = reason === "timeout" ? "timeout" : "killed";
      after.endedAt = Date.now();
      after.updatedAt = after.endedAt;
      after.signal = reason === "timeout" ? "TIMEOUT" : "KILL";
      this.procs.delete(taskId);
      this.tasks.set(taskId, after);
      this.resolveWaiters(taskId, after);
      this.emitEvent({ type: "finished", task: { ...after } });
      return { ...after };
    }
    return after ? { ...after } : { ...current, status: reason === "timeout" ? "timeout" : "killed" };
  }

  /** 测试用：清空 */
  resetForTests(): void {
    for (const id of [...this.procs.keys()]) {
      void this.kill(id, "user");
    }
    this.tasks.clear();
    this.procs.clear();
    this.waiters.clear();
    this.removeAllListeners();
  }
}

let singleton: BackgroundTaskRegistry | null = null;

export function getBackgroundTaskRegistry(): BackgroundTaskRegistry {
  if (!singleton) singleton = new BackgroundTaskRegistry();
  return singleton;
}

/** 仅测试 */
export function resetBackgroundTaskRegistryForTests(): void {
  if (singleton) singleton.resetForTests();
  singleton = null;
}

export function formatBgTaskLine(task: BackgroundTask): string {
  const shortCmd =
    task.command.length > 60 ? task.command.slice(0, 57) + "…" : task.command;
  const dur =
    task.endedAt && task.createdAt
      ? `${Math.max(0, task.endedAt - task.createdAt)}ms`
      : "…";
  return `[${task.status.toUpperCase()}] ${task.taskId}  ${shortCmd}  (${dur})`;
}

export function formatBgTaskNotify(event: BackgroundTaskEvent): string {
  const t = event.task;
  if (event.type === "started") {
    return `后台启动 ${t.taskId} · ${t.command.slice(0, 48)}`;
  }
  if (t.status === "completed") {
    return `后台完成 ${t.taskId}`;
  }
  if (t.status === "killed" || t.status === "timeout") {
    return `后台终止 ${t.taskId} (${t.status})`;
  }
  return `后台失败 ${t.taskId}${t.error ? `: ${t.error.slice(0, 40)}` : ""}`;
}
