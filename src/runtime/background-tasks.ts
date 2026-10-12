// ============================================================
// G3.2 — 统一后台任务注册表（shell bg · task_id · list/wait/kill）
// 进程内；不替代 mission / session loop，仅统一可观察的 task_id 面。
// ============================================================

import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { terminateManagedProcessTree } from "../execution/managed-command.js";
import { getRuntimeRootsFromEnv } from "../runtime-paths.js";
import { assertSessionLeaseToken, isSessionLeaseTokenActive } from "./session-lease.js";

export type BgTaskKind = "shell" | "subagent";
export type BgTaskStatus = "running" | "completed" | "failed" | "killed" | "timeout" | "unknown_outcome" | "reconciliation_pending" | "acknowledged";

export interface BackgroundTaskOwner {
  workspaceDir: string;
  sessionId?: string;
  runId?: string;
  leaseToken?: string;
}

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
  commandHash?: string;
  processStartedAt?: number;
  workspaceBaseline?: {
    available: boolean;
    head?: string;
    fingerprint?: string;
    files: Record<string, { hash: string; created: boolean }>;
  };
  runtime?: "native" | "wsl";
  wslPidFile?: string;
  ownerWorkspace?: string;
  ownerSessionId?: string;
  ownerRunId?: string;
  accountingStatus?: "pending" | "settled";
  ownerLeaseToken?: string;
  recordRevision?: number;
}

export type BackgroundTaskEvent =
  | { type: "started"; task: BackgroundTask }
  | { type: "updated"; task: BackgroundTask }
  | { type: "finished"; task: BackgroundTask };

const MAX_TASKS_RETAINED = 50;
const MAX_OUTPUT_BYTES = 512 * 1024;
const HEAD_KEEP_BYTES = 64 * 1024;
const DEFAULT_MAX_LIFETIME_MS = 30 * 60 * 1000; // 30 min
const MAX_CONCURRENT_RUNNING = 8;

function makeTaskId(): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `bg_${t}_${r}`;
}

export function canonicalBackgroundWorkspace(workspaceDir: string): string {
  let resolved = path.resolve(workspaceDir);
  try { resolved = realpathSync.native(resolved); } catch { /* preserve the resolved path for missing roots */ }
  resolved = resolved.replace(/[\\/]+$/, "");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function isBackgroundTaskOwnedBy(task: BackgroundTask, owner: BackgroundTaskOwner): boolean {
  const expectedWorkspace = canonicalBackgroundWorkspace(owner.workspaceDir);
  if (task.ownerWorkspace) {
    if (canonicalBackgroundWorkspace(task.ownerWorkspace) !== expectedWorkspace) return false;
  } else {
    const legacyCwd = canonicalBackgroundWorkspace(task.cwd);
    const relative = path.relative(expectedWorkspace, legacyCwd);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return false;
  }
  // Legacy manifests did not have explicit owner ids. They can be adopted only
  // through their workspace boundary; newly-created records require exact ids.
  if (task.ownerSessionId && task.ownerSessionId !== owner.sessionId) return false;
  if (owner.runId && task.ownerRunId && task.ownerRunId !== owner.runId) return false;
  return true;
}

function omissionMarker(omitted: number): string {
  return `…[省略 ${Math.max(0, omitted)} 字节]…`;
}

function utf8PrefixLength(buf: Buffer, maxBytes: number): number {
  let end = Math.min(Math.max(0, maxBytes), buf.byteLength);
  while (end > 0 && end < buf.byteLength && (buf[end] & 0xc0) === 0x80) end -= 1;
  return end;
}

function expectedUtf8Length(lead: number): number {
  if ((lead & 0x80) === 0) return 1;
  if ((lead & 0xe0) === 0xc0) return 2;
  if ((lead & 0xf0) === 0xe0) return 3;
  if ((lead & 0xf8) === 0xf0) return 4;
  return 1;
}

function trimPartialUtf8End(buf: Buffer): Buffer {
  if (buf.byteLength === 0) return buf;
  let index = buf.byteLength - 1;
  while (index >= 0 && (buf[index] & 0xc0) === 0x80) index -= 1;
  if (index < 0) return Buffer.alloc(0);
  if (index + expectedUtf8Length(buf[index]) > buf.byteLength) return buf.subarray(0, index);
  return buf;
}

function skipPartialUtf8Start(buf: Buffer, start: number): number {
  let index = Math.max(0, start);
  while (index < buf.byteLength && (buf[index] & 0xc0) === 0x80) index += 1;
  return index;
}

/** Head 64KB + omission marker + tail. The returned byte length never exceeds maxBytes. */
export function truncateBytes(text: string, maxBytes: number): string {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) return "";
  const buf = Buffer.from(text, "utf8");
  if (buf.byteLength <= maxBytes) return text;

  const headBudget = Math.min(HEAD_KEEP_BYTES, maxBytes);
  let head = trimPartialUtf8End(buf.subarray(0, utf8PrefixLength(buf, headBudget)));
  let omitted = buf.byteLength - head.byteLength;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const markerBytes = Buffer.byteLength(omissionMarker(omitted));
    if (head.byteLength + markerBytes >= maxBytes) {
      head = trimPartialUtf8End(buf.subarray(0, utf8PrefixLength(buf, Math.max(0, maxBytes - markerBytes))));
      omitted = buf.byteLength - head.byteLength;
      continue;
    }
    const tailBudget = maxBytes - head.byteLength - markerBytes;
    let tailStart = Math.max(head.byteLength, buf.byteLength - tailBudget);
    tailStart = skipPartialUtf8Start(buf, tailStart);
    const tail = buf.subarray(tailStart);
    const actualOmitted = buf.byteLength - head.byteLength - tail.byteLength;
    const rendered = head.toString("utf8") + omissionMarker(actualOmitted) + tail.toString("utf8");
    if (actualOmitted > 0 && Buffer.byteLength(rendered) <= maxBytes) return rendered;
    omitted = actualOmitted;
  }

  const fallbackMarker = omissionMarker(buf.byteLength);
  const fallbackHead = trimPartialUtf8End(
    buf.subarray(0, utf8PrefixLength(buf, Math.max(0, maxBytes - Buffer.byteLength(fallbackMarker)))),
  );
  const fallback = fallbackHead.toString("utf8") + omissionMarker(buf.byteLength - fallbackHead.byteLength);
  if (Buffer.byteLength(fallback) <= maxBytes) return fallback;
  return buf.subarray(0, utf8PrefixLength(buf, maxBytes)).toString("utf8");
}

/** Bounded capture so a live stream can keep its tail without storing the whole output. */
class BoundedOutput {
  private head = Buffer.alloc(0);
  private tail = Buffer.alloc(0);
  private omitted = 0;
  private readonly headBudget: number;
  private readonly tailBudget: number;

  constructor(private readonly maxBytes: number) {
    this.headBudget = Math.min(HEAD_KEEP_BYTES, Math.max(0, maxBytes));
    this.tailBudget = Math.max(0, maxBytes - this.headBudget);
  }

  push(chunk: Buffer): void {
    if (chunk.byteLength === 0) return;
    let rest = chunk;
    if (this.head.byteLength < this.headBudget) {
      const take = Math.min(this.headBudget - this.head.byteLength, rest.byteLength);
      this.head = Buffer.concat([this.head, rest.subarray(0, take)]);
      rest = rest.subarray(take);
    }
    if (rest.byteLength === 0) return;
    this.tail = Buffer.concat([this.tail, rest]);
    if (this.tail.byteLength > this.tailBudget) {
      const drop = this.tail.byteLength - this.tailBudget;
      this.omitted += drop;
      this.tail = this.tail.subarray(drop);
    }
  }

  text(): string {
    if (this.omitted === 0) {
      return truncateBytes(Buffer.concat([this.head, this.tail]).toString("utf8"), this.maxBytes);
    }
    const head = trimPartialUtf8End(this.head);
    let start = skipPartialUtf8Start(this.tail, 0);
    let dropped = this.omitted + (this.head.byteLength - head.byteLength) + start;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const markerBytes = Buffer.byteLength(omissionMarker(dropped));
      const tail = this.tail.subarray(start);
      if (head.byteLength + markerBytes + tail.byteLength <= this.maxBytes) {
        const rendered = head.toString("utf8") + omissionMarker(dropped) + tail.toString("utf8");
        if (Buffer.byteLength(rendered) <= this.maxBytes) return rendered;
      }
      const overflow = head.byteLength + markerBytes + tail.byteLength - this.maxBytes;
      const next = skipPartialUtf8Start(this.tail, start + Math.max(1, overflow));
      dropped += next - start;
      start = next;
      if (start >= this.tail.byteLength) break;
    }
    return truncateBytes(head.toString("utf8"), this.maxBytes);
  }
}

export class BackgroundTaskRegistry extends EventEmitter {
  private readonly tasks = new Map<string, BackgroundTask>();
  private readonly procs = new Map<string, ChildProcess>();
  private readonly waiters = new Map<string, Array<(task: BackgroundTask) => void>>();
  private readonly cancelers = new Map<string, () => void | Promise<void>>();
  private readonly terminatingTasks = new Set<string>();
  private readonly lifeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Legacy aggregate manifest; read-only after migration. */
  private readonly manifestPath: string | null;
  /** One atomic record per task prevents different Qling processes losing each other's updates. */
  private readonly recordsDir: string | null;
  private recordReadErrors: string[] = [];
  private legacyManifestReadError = false;
  private readonly requireSessionLease: boolean;

  constructor(options: { stateDir?: string; persist?: boolean } = {}) {
    super();
    const enabled = options.persist ?? process.env.QLING_FEATURES_RELIABILITY_V2 === "true";
    const stateDir = path.resolve(options.stateDir ?? process.env.QLING_FILE_STATE_DIR ?? path.join(os.homedir(), ".qling"));
    this.manifestPath = enabled ? path.join(stateDir, "background-tasks.json") : null;
    this.recordsDir = enabled ? path.join(stateDir, "background-tasks") : null;
    this.requireSessionLease = enabled && process.env.QLING_FEATURES_RELIABILITY_V2 === "true";
    this.restoreManifest();
  }

  list(options: { includeFinished?: boolean; limit?: number } = {}): BackgroundTask[] {
    return this.listMatching(() => true, options);
  }

  /** Filter by durable workspace/session ownership before applying the caller's limit. */
  listOwned(
    owner: BackgroundTaskOwner,
    options: { includeFinished?: boolean; limit?: number } = {},
  ): BackgroundTask[] {
    return this.listMatching((task) => isBackgroundTaskOwnedBy(task, owner), options);
  }

  /** Completion gates must see every unresolved side effect; no history limit is applied. */
  listUnsettledOwned(owner: BackgroundTaskOwner): BackgroundTask[] {
    this.refreshTaskRecords();
    if (this.legacyManifestReadError || this.recordReadErrors.length > 0) {
      const errors = [...(this.legacyManifestReadError ? ["<legacy-manifest>"] : []), ...this.recordReadErrors];
      throw new Error(`BACKGROUND_RECORD_UNREADABLE: ${errors.join(", ")}`);
    }
    return [...this.tasks.values()]
      .filter((task) => isBackgroundTaskOwnedBy(task, owner) && this.isUnsettled(task))
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((task) => ({ ...task }));
  }

  private listMatching(
    predicate: (task: BackgroundTask) => boolean,
    options: { includeFinished?: boolean; limit?: number },
  ): BackgroundTask[] {
    const includeFinished = options.includeFinished !== false;
    const limit = Math.max(1, Math.min(100, options.limit ?? 40));
    const all = [...this.tasks.values()]
      .filter(predicate)
      .sort((a, b) => b.createdAt - a.createdAt);
    const filtered = includeFinished ? all : all.filter((t) => t.status === "running");
    return filtered.slice(0, limit).map((t) => ({ ...t }));
  }

  get(taskId: string): BackgroundTask | null {
    const t = this.tasks.get(taskId);
    return t ? { ...t } : null;
  }

  setWorkspaceBaseline(taskId: string, baseline: NonNullable<BackgroundTask["workspaceBaseline"]>): void {
    const current = this.tasks.get(taskId);
    if (!current) return;
    current.workspaceBaseline = structuredClone(baseline);
    current.updatedAt = Date.now();
    this.tasks.set(taskId, current);
    this.persistTask(taskId);
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
    executable?: string;
    executableArgs?: string[];
    runtime?: "native" | "wsl";
    workspaceBaseline?: NonNullable<BackgroundTask["workspaceBaseline"]>;
    owner?: BackgroundTaskOwner;
    /** 最长存活秒；默认 1800；0 表示不设定时 kill */
    timeoutSec?: number;
  }): BackgroundTask {
    this.assertOwnerLease(options.owner);
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
      commandHash: createHash("sha256").update(command).digest("hex"),
      processStartedAt: now,
      runtime: options.runtime ?? "native",
      ownerWorkspace: canonicalBackgroundWorkspace(options.owner?.workspaceDir ?? options.cwd),
      ...(options.owner?.sessionId ? { ownerSessionId: options.owner.sessionId } : {}),
      ...(options.owner?.runId ? { ownerRunId: options.owner.runId } : {}),
      ...(options.owner?.leaseToken ? { ownerLeaseToken: options.owner.leaseToken } : {}),
      accountingStatus: "pending",
      ...(options.workspaceBaseline ? { workspaceBaseline: structuredClone(options.workspaceBaseline) } : {}),
    };

    const shell = options.executable ?? (process.platform === "win32" ? "cmd.exe" : "/bin/sh");
    let shellArgs = options.executableArgs ?? (process.platform === "win32" ? ["/c", command] : ["-c", command]);
    if (process.platform === "win32" && options.runtime === "wsl") {
      const wslPidFile = `/tmp/qling-bg-${process.pid}-${randomUUID()}.pid`;
      const original = shellArgs.at(-1) ?? command;
      const quoted = `'${original.replace(/'/g, `'\\''`)}'`;
      shellArgs = [...shellArgs.slice(0, -1), `setsid sh -lc ${quoted} & pgid=$!; printf '%s' "$pgid" > '${wslPidFile}'; wait "$pgid"`];
      task.wslPidFile = wslPidFile;
    }
    const proc = spawn(shell, shellArgs, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    });

    task.pid = proc.pid;
    this.tasks.set(taskId, task);
    this.procs.set(taskId, proc);
    this.trimHistory();
    this.emitEvent({ type: "started", task: { ...task } });
    try {
      this.persistTask(taskId, true);
    } catch (error) {
      try { proc.kill("SIGKILL"); } catch { /* process outcome remains unknown to the caller */ }
      this.procs.delete(taskId);
      this.tasks.delete(taskId);
      throw error;
    }

    const stdoutCap = new BoundedOutput(MAX_OUTPUT_BYTES);
    const stderrCap = new BoundedOutput(MAX_OUTPUT_BYTES);
    let settled = false;

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdoutCap.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      this.patchOutput(taskId, stdoutCap.text(), stderrCap.text());
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrCap.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      this.patchOutput(taskId, stdoutCap.text(), stderrCap.text());
    });

    let lifeTimer: ReturnType<typeof setTimeout> | null = null;
    if (maxLifetimeMs > 0) {
      lifeTimer = setTimeout(() => {
        void this.kill(taskId, "timeout");
      }, maxLifetimeMs);
      this.lifeTimers.set(taskId, lifeTimer);
    }

    const finish = (status: BgTaskStatus, code: number | null, signal: string | null, error?: string) => {
      if (settled) return;
      settled = true;
      if (lifeTimer) clearTimeout(lifeTimer);
      this.lifeTimers.delete(taskId);
      this.procs.delete(taskId);
      const current = this.tasks.get(taskId);
      if (!current) return;
      current.status = status;
      current.exitCode = code;
      current.signal = signal;
      current.error = error;
      current.endedAt = Date.now();
      current.updatedAt = current.endedAt;
      current.output = this.mergeOutput(stdoutCap.text(), stderrCap.text());
      this.tasks.set(taskId, current);
      this.resolveWaiters(taskId, current);
      this.emitEvent({ type: "finished", task: { ...current } });
      this.persistTask(taskId);
    };

    proc.on("close", (code, signal) => {
      if (settled || this.terminatingTasks.has(taskId) || this.tasks.get(taskId)?.status !== "running") return;
      const status: BgTaskStatus = (code ?? 0) === 0 ? "completed" : "failed";
      finish(status, code, signal);
    });
    proc.on("error", (err) => {
      if (this.terminatingTasks.has(taskId) || this.tasks.get(taskId)?.status !== "running") return;
      finish("failed", null, null, err.message);
    });

    return { ...task };
  }

  startPromise(options: {
    label: string;
    cwd: string;
    promise: Promise<string>;
    onCancel?: () => void | Promise<void>;
    timeoutMs?: number;
    owner?: BackgroundTaskOwner;
  }): BackgroundTask {
    this.assertOwnerLease(options.owner);
    if (this.runningCount() >= MAX_CONCURRENT_RUNNING) {
      throw new Error(`too many background tasks (max ${MAX_CONCURRENT_RUNNING} running)`);
    }
    const taskId = makeTaskId();
    const now = Date.now();
    const maxLifetimeMs = Math.max(1000, options.timeoutMs ?? 10 * 60 * 1000);
    const task: BackgroundTask = {
      taskId,
      kind: "subagent",
      status: "running",
      command: options.label,
      cwd: options.cwd,
      createdAt: now,
      updatedAt: now,
      output: "",
      maxLifetimeMs,
      commandHash: createHash("sha256").update(options.label).digest("hex"),
      processStartedAt: now,
      ownerWorkspace: canonicalBackgroundWorkspace(options.owner?.workspaceDir ?? options.cwd),
      ...(options.owner?.sessionId ? { ownerSessionId: options.owner.sessionId } : {}),
      ...(options.owner?.runId ? { ownerRunId: options.owner.runId } : {}),
      ...(options.owner?.leaseToken ? { ownerLeaseToken: options.owner.leaseToken } : {}),
      accountingStatus: "pending",
    };
    this.tasks.set(taskId, task);
    if (options.onCancel) this.cancelers.set(taskId, options.onCancel);
    this.trimHistory();
    this.emitEvent({ type: "started", task: { ...task } });
    try {
      this.persistTask(taskId, true);
    } catch (error) {
      this.tasks.delete(taskId);
      this.cancelers.delete(taskId);
      if (options.onCancel) void Promise.resolve(options.onCancel()).catch(() => undefined);
      throw error;
    }
    const timer = setTimeout(() => {
      void this.kill(taskId, "timeout");
    }, maxLifetimeMs);
    void options.promise.then(
      (output) => this.finishPromiseTask(taskId, "completed", output),
      (error) => this.finishPromiseTask(
        taskId,
        "failed",
        "",
        error instanceof Error ? error.message : String(error)
      )
    ).finally(() => clearTimeout(timer));
    return { ...task };
  }

  private finishPromiseTask(
    taskId: string,
    status: "completed" | "failed",
    output: string,
    error?: string
  ): void {
    const current = this.tasks.get(taskId);
    if (!current || current.status !== "running") return;
    current.status = status;
    current.output = truncateBytes(output || (error ? `error: ${error}` : "(no output)"), MAX_OUTPUT_BYTES);
    current.error = error;
    current.exitCode = status === "completed" ? 0 : 1;
    current.endedAt = Date.now();
    current.updatedAt = current.endedAt;
    this.cancelers.delete(taskId);
    this.tasks.set(taskId, current);
    this.resolveWaiters(taskId, current);
    this.emitEvent({ type: "finished", task: { ...current } });
    this.persistTask(taskId);
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
      .filter((t) => t.status !== "running" && t.status !== "unknown_outcome" && t.status !== "reconciliation_pending" && t.accountingStatus === "settled")
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
    if (!proc && current.ownerSessionId && current.ownerLeaseToken && this.recordsDir
      && isSessionLeaseTokenActive(path.dirname(this.recordsDir), current.ownerSessionId, current.ownerLeaseToken)) {
      throw new Error(`task ${taskId} is owned by another live Qling process`);
    }
    const cancel = this.cancelers.get(taskId);
    if (cancel) {
      try {
        await cancel();
      } catch {
        // cancellation is best-effort; status still becomes killed/timeout
      }
      this.cancelers.delete(taskId);
    }
    this.terminatingTasks.add(taskId);
    let terminationConfirmed = false;
    try {
      terminationConfirmed = proc
        ? await terminateManagedProcessTree({ child: proc, runtime: current.runtime, ...(current.wslPidFile ? { wslPidFile: current.wslPidFile } : {}) })
        : current.status !== "running";
    } catch {
      terminationConfirmed = false;
    }
    const lifeTimer = this.lifeTimers.get(taskId);
    if (lifeTimer) clearTimeout(lifeTimer);
    this.lifeTimers.delete(taskId);
    const after = this.tasks.get(taskId);
    if (after && after.status === "running") {
      after.status = terminationConfirmed ? (reason === "timeout" ? "timeout" : "killed") : "unknown_outcome";
      after.endedAt = Date.now();
      after.updatedAt = after.endedAt;
      after.signal = terminationConfirmed ? (reason === "timeout" ? "TIMEOUT" : "KILL") : "UNKNOWN";
      if (!terminationConfirmed) after.error = "process tree termination could not be confirmed";
      this.procs.delete(taskId);
      this.tasks.set(taskId, after);
      this.resolveWaiters(taskId, after);
      this.emitEvent({ type: "finished", task: { ...after } });
      this.persistTask(taskId);
      this.terminatingTasks.delete(taskId);
      return { ...after };
    }
    this.terminatingTasks.delete(taskId);
    return after ? { ...after } : { ...current, status: terminationConfirmed ? (reason === "timeout" ? "timeout" : "killed") : "unknown_outcome" };
  }

  /**
   * Cancel every running task owned by one run (or session when runId is omitted).
   * Terminal results remain accountingStatus=pending until a later Agent checkpoint
   * consumes them, so cancellation cannot hide possible workspace side effects.
   */
  async terminateOwned(
    owner: BackgroundTaskOwner,
    reason: "user" | "timeout" = "user",
  ): Promise<BackgroundTask[]> {
    const taskIds = this.listOwned(owner, { includeFinished: false, limit: 100 })
      .map((task) => task.taskId);
    return await Promise.all(taskIds.map((taskId) => this.kill(taskId, reason)));
  }

  /** Begin an idempotent, durable reconciliation after explicit approval. */
  beginUnknownOutcomeReconciliation(taskId: string, owner: BackgroundTaskOwner): BackgroundTask {
    const current = this.tasks.get(taskId);
    if (!current) throw new Error(`unknown task_id: ${taskId}`);
    if (!isBackgroundTaskOwnedBy(current, owner)) throw new Error(`task ${taskId} belongs to a different workspace or run`);
    this.assertTaskMutationLease(current, owner);
    if (current.status === "reconciliation_pending") return { ...current };
    if (current.status !== "unknown_outcome") throw new Error(`task ${taskId} is ${current.status}, not unknown_outcome`);
    const previous = structuredClone(current);
    if (owner.leaseToken) current.ownerLeaseToken = owner.leaseToken;
    current.status = "reconciliation_pending";
    current.updatedAt = Date.now();
    current.endedAt ??= current.updatedAt;
    current.error = "operator approved reconciliation; deterministic verification is still required";
    this.tasks.set(taskId, current);
    try { this.writeTaskRecord(current); }
    catch (error) { this.tasks.set(taskId, previous); throw error; }
    return { ...current };
  }

  /** Finalize reconciliation only after the Agent checkpoint contains its mutation. */
  completeUnknownOutcomeReconciliation(taskId: string, owner: BackgroundTaskOwner): BackgroundTask {
    const current = this.tasks.get(taskId);
    if (!current) throw new Error(`unknown task_id: ${taskId}`);
    if (!isBackgroundTaskOwnedBy(current, owner)) throw new Error(`task ${taskId} belongs to a different workspace or run`);
    this.assertTaskMutationLease(current, owner);
    if (current.status === "acknowledged") return { ...current };
    if (current.status !== "reconciliation_pending") throw new Error(`task ${taskId} is ${current.status}, not reconciliation_pending`);
    const previous = structuredClone(current);
    if (owner.leaseToken) current.ownerLeaseToken = owner.leaseToken;
    current.status = "acknowledged";
    current.accountingStatus = "settled";
    current.updatedAt = Date.now();
    current.error = "unknown outcome acknowledged after durable mutation checkpoint";
    this.tasks.set(taskId, current);
    try { this.writeTaskRecord(current); }
    catch (error) { this.tasks.set(taskId, previous); throw error; }
    this.resolveWaiters(taskId, current);
    this.emitEvent({ type: "finished", task: { ...current } });
    return { ...current };
  }

  /** Mark a terminal task consumed only after its Agent checkpoint is durable. */
  markAccountingSettled(taskId: string, owner: BackgroundTaskOwner): BackgroundTask {
    const current = this.tasks.get(taskId);
    if (!current) throw new Error(`unknown task_id: ${taskId}`);
    if (!isBackgroundTaskOwnedBy(current, owner)) throw new Error(`task ${taskId} belongs to a different workspace or run`);
    this.assertTaskMutationLease(current, owner);
    if (current.status === "running" || current.status === "unknown_outcome" || current.status === "reconciliation_pending") {
      throw new Error(`task ${taskId} cannot be settled while status is ${current.status}`);
    }
    if (current.accountingStatus === "settled") return { ...current };
    const previous = structuredClone(current);
    if (owner.leaseToken) current.ownerLeaseToken = owner.leaseToken;
    current.accountingStatus = "settled";
    current.updatedAt = Date.now();
    this.tasks.set(taskId, current);
    try { this.writeTaskRecord(current); }
    catch (error) { this.tasks.set(taskId, previous); throw error; }
    return { ...current };
  }

  /** 测试用：清空 */
  resetForTests(): void {
    for (const id of [...this.procs.keys()]) {
      void this.kill(id, "user");
    }
    this.tasks.clear();
    this.procs.clear();
    this.waiters.clear();
    this.cancelers.clear();
    this.terminatingTasks.clear();
    for (const timer of this.lifeTimers.values()) clearTimeout(timer);
    this.lifeTimers.clear();
    this.removeAllListeners();
  }

  private restoreManifest(): void {
    if (this.manifestPath && existsSync(this.manifestPath)) {
      try {
        const raw = JSON.parse(readFileSync(this.manifestPath, "utf8")) as { version?: number; tasks?: BackgroundTask[] };
        if (raw.version === 1 && Array.isArray(raw.tasks)) {
          for (const stored of raw.tasks) this.mergeRestoredTask(stored, false);
        }
      } catch {
        this.legacyManifestReadError = true;
      }
    }
    this.refreshTaskRecords();
    this.trimHistory();
  }

  private isUnsettled(task: BackgroundTask): boolean {
    return task.accountingStatus !== "settled"
      || task.status === "running"
      || task.status === "unknown_outcome"
      || task.status === "reconciliation_pending";
  }

  private assertOwnerLease(owner?: BackgroundTaskOwner): void {
    if (!this.requireSessionLease || !owner?.sessionId) return;
    if (!owner.leaseToken || !this.recordsDir) {
      throw new Error(`BACKGROUND_SESSION_LEASE_REQUIRED: ${owner.sessionId}`);
    }
    assertSessionLeaseToken(path.dirname(this.recordsDir), owner.sessionId, owner.leaseToken);
  }

  private assertTaskMutationLease(task: BackgroundTask, owner: BackgroundTaskOwner): void {
    if (!this.requireSessionLease || !task.ownerSessionId) return;
    this.assertOwnerLease(owner);
    if (task.ownerLeaseToken && task.ownerLeaseToken !== owner.leaseToken && this.recordsDir
      && isSessionLeaseTokenActive(path.dirname(this.recordsDir), task.ownerSessionId, task.ownerLeaseToken)) {
      throw new Error(`BACKGROUND_TASK_LEASE_CONFLICT: ${task.taskId}`);
    }
  }

  private mergeRestoredTask(stored: BackgroundTask, authoritativeRecord: boolean): void {
    if (!stored?.taskId) return;
    const existing = this.tasks.get(stored.taskId);
    const storedRevision = stored.recordRevision ?? 0;
    const existingRevision = existing?.recordRevision ?? 0;
    if (existing && (existingRevision > storedRevision || (existingRevision === storedRevision && existing.updatedAt >= stored.updatedAt))) return;
    if (!authoritativeRecord && existing && existing.updatedAt > stored.updatedAt) return;
    const liveLease = Boolean(
      stored.status === "running"
      && stored.ownerSessionId
      && stored.ownerLeaseToken
      && this.recordsDir
      && isSessionLeaseTokenActive(path.dirname(this.recordsDir), stored.ownerSessionId, stored.ownerLeaseToken),
    );
    const restored: BackgroundTask = {
      ...stored,
      command: stored.commandHash ? `<redacted sha256=${stored.commandHash.slice(0, 16)}>` : "<redacted>",
      output: "",
      accountingStatus: stored.accountingStatus
        ?? (stored.ownerWorkspace || stored.status === "running" ? "pending" : "settled"),
      ...(stored.status === "running" && !liveLease
        ? {
            status: "unknown_outcome" as const,
            error: "process was active in another process; identity cannot be safely reattached",
            updatedAt: Date.now(),
          }
        : {}),
    };
    if (!this.procs.has(restored.taskId)) this.tasks.set(restored.taskId, restored);
  }

  private taskRecordPrefix(taskId: string): string {
    return createHash("sha256").update(taskId).digest("hex");
  }

  private refreshTaskRecords(): void {
    if (!this.recordsDir || !existsSync(this.recordsDir)) return;
    const readErrors: string[] = [];
    try {
      for (const entry of readdirSync(this.recordsDir)) {
        if (!entry.endsWith(".json")) continue;
        try {
          this.mergeRestoredTask(this.readValidatedTaskRecord(path.join(this.recordsDir, entry)), true);
        } catch {
          readErrors.push(entry);
        }
      }
    } catch {
      readErrors.push("<record-directory>");
    }
    this.recordReadErrors = readErrors;
  }

  private readValidatedTaskRecord(recordPath: string): BackgroundTask {
    const raw = JSON.parse(readFileSync(recordPath, "utf8")) as {
      version?: number;
      task?: BackgroundTask;
      checksum?: string;
    };
    if ((raw.version !== 1 && raw.version !== 2) || !raw.task) {
      throw new Error("unsupported task record");
    }
    if (raw.version === 2) {
      const expected = createHash("sha256").update(JSON.stringify(raw.task)).digest("hex");
      if (raw.checksum !== expected) throw new Error("checksum mismatch");
    }
    return raw.task;
  }

  private writeTaskRecord(task: BackgroundTask): void {
    if (!this.recordsDir) return;
    mkdirSync(this.recordsDir, { recursive: true });
    if (this.requireSessionLease && task.ownerSessionId && !task.ownerLeaseToken) {
      throw new Error(`BACKGROUND_SESSION_LEASE_REQUIRED: ${task.ownerSessionId}`);
    }
    if (task.ownerSessionId && task.ownerLeaseToken) {
      assertSessionLeaseToken(path.dirname(this.recordsDir), task.ownerSessionId, task.ownerLeaseToken);
    }
    this.refreshTaskRecords();
    if (this.recordReadErrors.length > 0) {
      throw new Error(`BACKGROUND_RECORD_UNREADABLE: ${this.recordReadErrors.join(", ")}`);
    }
    const current = this.tasks.get(task.taskId);
    const diskRevision = current && current !== task ? current.recordRevision ?? 0 : task.recordRevision ?? 0;
    if ((task.recordRevision ?? 0) < diskRevision) {
      throw new Error(`BACKGROUND_RECORD_STALE_WRITE: ${task.taskId}`);
    }
    const nextRevision = Math.max(task.recordRevision ?? 0, diskRevision) + 1;
    task.recordRevision = nextRevision;
    const stored: BackgroundTask = { ...task, command: "<redacted>", output: "", recordRevision: nextRevision };
    const checksum = createHash("sha256").update(JSON.stringify(stored)).digest("hex");
    const prefix = this.taskRecordPrefix(task.taskId);
    const target = path.join(this.recordsDir, `${prefix}.${String(nextRevision).padStart(12, "0")}.${randomUUID()}.json`);
    const temp = `${target}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify({ version: 2, task: stored, checksum }), { encoding: "utf8", mode: 0o600, flag: "wx" });
    try {
      renameSync(temp, target);
    } catch (error) {
      try { unlinkSync(temp); } catch { /* retain the prior immutable record */ }
      throw error;
    }
    this.trimPersistedHistory();
  }

  private trimPersistedHistory(): void {
    if (!this.recordsDir || !existsSync(this.recordsDir)) return;
    const byTask = new Map<string, Array<{ path: string; task: BackgroundTask }>>();
    try {
      for (const entry of readdirSync(this.recordsDir)) {
        if (!entry.endsWith(".json")) continue;
        const recordPath = path.join(this.recordsDir, entry);
        try {
          const task = this.readValidatedTaskRecord(recordPath);
          if (!task.taskId) return;
          const records = byTask.get(task.taskId) ?? [];
          records.push({ path: recordPath, task });
          byTask.set(task.taskId, records);
        } catch {
          // Never delete recovery evidence while any record is unreadable.
          return;
        }
      }
      const settledLatest: Array<{ path: string; createdAt: number }> = [];
      for (const records of byTask.values()) {
        records.sort((a, b) => {
          const revision = (b.task.recordRevision ?? 0) - (a.task.recordRevision ?? 0);
          return revision !== 0 ? revision : b.task.updatedAt - a.task.updatedAt;
        });
        const [latest, ...obsolete] = records;
        if (!latest) continue;
        for (const record of obsolete) {
          try { unlinkSync(record.path); } catch { /* latest record is already durable */ }
        }
        if (!this.isUnsettled(latest.task)) {
          settledLatest.push({ path: latest.path, createdAt: latest.task.createdAt });
        }
      }
      settledLatest.sort((a, b) => b.createdAt - a.createdAt);
      for (const record of settledLatest.slice(MAX_TASKS_RETAINED)) {
        try { unlinkSync(record.path); } catch { /* best-effort settled task cleanup */ }
      }
    } catch { /* best-effort retention */ }
  }

  private persistTask(taskId: string, required = false): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    try { this.writeTaskRecord(task); }
    catch (error) {
      if (required) throw error;
      // A prior immutable record remains a conservative barrier. Later
      // checkpoint settlement retries the update and cannot silently succeed.
    }
  }
}

const registries = new Map<string, BackgroundTaskRegistry>();

function registryStateKey(stateDir: string): string {
  const resolved = path.resolve(stateDir);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/** Each Agent state directory owns an independent durable background registry. */
export function getBackgroundTaskRegistry(stateDir?: string): BackgroundTaskRegistry {
  const resolvedStateDir = path.resolve(stateDir ?? getRuntimeRootsFromEnv().fileStateDir);
  const key = registryStateKey(resolvedStateDir);
  let registry = registries.get(key);
  if (!registry) {
    registry = new BackgroundTaskRegistry({ stateDir: resolvedStateDir });
    registries.set(key, registry);
  }
  return registry;
}

/** 仅测试 */
export function resetBackgroundTaskRegistryForTests(): void {
  for (const registry of registries.values()) registry.resetForTests();
  registries.clear();
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
  if (t.status === "killed" || t.status === "timeout" || t.status === "acknowledged") {
    return `后台终止 ${t.taskId} (${t.status})`;
  }
  return `后台失败 ${t.taskId}${t.error ? `: ${t.error.slice(0, 40)}` : ""}`;
}
