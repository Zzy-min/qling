import { readdir, readFile, mkdir, appendFile, rm, stat, open } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ExecutionEvent, ProgressSnapshot } from "./types.js";

const EVENT_KEYS = [
  "eventId", "runId", "sessionId", "attemptId", "toolCallId", "type", "timestamp", "stage", "status", "tool",
  "category", "fingerprint", "durationMs", "recoveryAction",
] as const;

export class RunTraceStore {
  private readonly rootDir: string;
  private readonly now: () => number;
  private readonly retentionMs: number;
  private readonly maxBytes: number;
  private appendCount = 0;

  constructor(options: { rootDir?: string; now?: () => number; retentionDays?: number; maxBytes?: number } = {}) {
    this.rootDir = options.rootDir ?? path.join(os.homedir(), ".qling", "runs");
    this.now = options.now ?? (() => Date.now());
    this.retentionMs = (options.retentionDays ?? 30) * 24 * 60 * 60 * 1000;
    this.maxBytes = options.maxBytes ?? 50 * 1024 * 1024;
  }

  getRunPath(sessionId: string, runId: string): string {
    return path.join(this.rootDir, safeSegment(sessionId), `${safeSegment(runId)}.jsonl`);
  }

  async append(value: object): Promise<void> {
    const input = value as Record<string, unknown>;
    const sessionId = typeof input.sessionId === "string" ? input.sessionId : "unknown";
    const runId = typeof input.runId === "string" ? input.runId : "unknown";
    const event: Record<string, unknown> = {};
    for (const key of EVENT_KEYS) {
      if (input[key] !== undefined) event[key] = input[key];
    }
    if (input.progress && typeof input.progress === "object") {
      const value = input.progress as ProgressSnapshot;
      event.progress = {
        ...(typeof value.changed === "boolean" ? { changed: value.changed } : {}),
        ...(typeof value.diffHash === "string" ? { diffHash: value.diffHash } : {}),
        ...(Array.isArray(value.failingTests) ? { failingTests: value.failingTests.filter((item): item is string => typeof item === "string") } : {}),
        ...(typeof value.completedTodos === "number" ? { completedTodos: value.completedTodos } : {}),
      };
    }
    event.timestamp ??= this.now();
    const file = this.getRunPath(sessionId, runId);
    await mkdir(path.dirname(file), { recursive: true });
    await appendFile(file, `${JSON.stringify(event)}\n`, "utf8");
    this.appendCount++;
    if (this.appendCount % 100 === 0) await this.purge();
  }

  async readRun(sessionId: string, runId: string): Promise<ExecutionEvent[]> {
    try {
      const raw = await readFile(this.getRunPath(sessionId, runId), "utf8");
      return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as ExecutionEvent);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async listRunIds(sessionId: string): Promise<string[]> {
    const directory = path.join(this.rootDir, safeSegment(sessionId));
    try {
      const names = await readdir(directory);
      const entries = await Promise.all(names.filter((name) => name.endsWith(".jsonl")).map(async (name) => {
        const filePath = path.join(directory, name);
        return { id: name.slice(0, -6), mtimeMs: (await stat(filePath)).mtimeMs };
      }));
      return entries.sort((a, b) => b.mtimeMs - a.mtimeMs).map((entry) => entry.id);
    } catch {
      return [];
    }
  }

  async queryRecent(sessionId: string, runId: string, options: { limit?: number; maxScanBytes?: number } = {}): Promise<{
    events: ExecutionEvent[];
    scannedBytes: number;
    truncated: boolean;
  }> {
    const limit = Math.max(1, options.limit ?? 50);
    const maxScanBytes = Math.max(1_024, options.maxScanBytes ?? 1024 * 1024);
    const filePath = this.getRunPath(sessionId, runId);
    let handle;
    try {
      handle = await open(filePath, "r");
      const info = await handle.stat();
      const scannedBytes = Math.min(info.size, maxScanBytes);
      const buffer = Buffer.alloc(scannedBytes);
      await handle.read(buffer, 0, scannedBytes, info.size - scannedBytes);
      let text = buffer.toString("utf8");
      if (scannedBytes < info.size) text = text.slice(text.indexOf("\n") + 1);
      const events = text.split(/\r?\n/).filter(Boolean).slice(-limit).map((line) => JSON.parse(line) as ExecutionEvent);
      return { events, scannedBytes, truncated: scannedBytes < info.size };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { events: [], scannedBytes: 0, truncated: false };
      throw error;
    } finally {
      await handle?.close();
    }
  }

  async purge(): Promise<void> {
    const files = await this.collectFiles();
    const cutoff = this.now() - this.retentionMs;
    let total = files.reduce((sum, file) => sum + file.size, 0);
    for (const file of files.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
      if (file.mtimeMs < cutoff || total > this.maxBytes) {
        await rm(file.path, { force: true });
        total -= file.size;
      }
    }
  }

  private async collectFiles(): Promise<Array<{ path: string; size: number; mtimeMs: number }>> {
    const result: Array<{ path: string; size: number; mtimeMs: number }> = [];
    let sessions: string[] = [];
    try { sessions = await readdir(this.rootDir); } catch { return result; }
    for (const session of sessions) {
      const directory = path.join(this.rootDir, session);
      let files: string[] = [];
      try { files = await readdir(directory); } catch { continue; }
      for (const file of files.filter((name) => name.endsWith(".jsonl"))) {
        const filePath = path.join(directory, file);
        const info = await stat(filePath);
        result.push({ path: filePath, size: info.size, mtimeMs: info.mtimeMs });
      }
    }
    return result;
  }
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}
