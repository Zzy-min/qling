// ============================================================
// 轻灵 - Projection Worker（后台投影）
// 定期回放 WAL 条目到 PersistedMemory，执行 checkpoint
// ============================================================

import { WriteAheadLog, WALEntry } from "./wal.js";
import type { PersistedEntry } from "../types.js";

export interface ProjectionWorkerOptions {
  intervalMs: number;
  maxPendingEntries: number;
}

const DEFAULT_OPTIONS: ProjectionWorkerOptions = {
  intervalMs: 5000,
  maxPendingEntries: 50,
};

export class ProjectionWorker {
  private wal: WriteAheadLog;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private applyEntry: (entry: WALEntry) => void;
  private getEntries: () => PersistedEntry[];
  private onCheckpoint?: (entries: PersistedEntry[]) => Promise<void>;
  private options: ProjectionWorkerOptions;
  private firstRun = true;
  private projectedCount = 0;

  constructor(
    wal: WriteAheadLog,
    callbacks: {
      applyEntry: (entry: WALEntry) => void;
      getEntries: () => PersistedEntry[];
      onCheckpoint?: (entries: PersistedEntry[]) => Promise<void>;
    },
    options: Partial<ProjectionWorkerOptions> = {}
  ) {
    this.wal = wal;
    this.applyEntry = callbacks.applyEntry;
    this.getEntries = callbacks.getEntries;
    this.onCheckpoint = callbacks.onCheckpoint;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => this.tick(), this.options.intervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async projectOnce(): Promise<number> {
    const fromSeq = this.firstRun ? 0 : this.wal.getLastCheckpointSeq() + 1;
    const entries = await this.wal.readEntries(fromSeq);
    if (entries.length === 0) {
      this.firstRun = false;
      return 0;
    }

    for (const entry of entries) {
      this.applyEntry(entry);
    }

    // checkpoint
    const currentEntries = this.getEntries();
    await this.wal.checkpoint(currentEntries);

    // trigger post-checkpoint hook
    if (this.onCheckpoint) {
      this.onCheckpoint(currentEntries).catch(err => {
        console.error(`[ProjectionWorker] onCheckpoint hook failed: ${err.message}`);
      });
    }

    this.projectedCount += entries.length;
    this.firstRun = false;
    return entries.length;
  }

  async forceCheckpoint(): Promise<void> {
    if (this.wal.isDirty()) {
      await this.wal.checkpoint(this.getEntries());
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  getProjectedCount(): number {
    return this.projectedCount;
  }

  // --- Private ---

  private async tick(): Promise<void> {
    if (!this.running) return;
    try {
      const pending = this.wal.getPendingCount();
      if (pending === 0 && !this.firstRun) return;
      if (pending > this.options.maxPendingEntries || this.firstRun) {
        const count = await this.projectOnce();
        if (count > 0 && process.env.QLING_MEMORY_DEBUG === "1") {
          console.error(`[ProjectionWorker] replayed ${count} entries, checkpoint saved`);
        }
      }
    } catch (err) {
      // 仅致命错误：TUI quiet 下仍可能被 guard 过滤；debug 时可见
      console.error(`[ProjectionWorker] error: ${(err as Error).message}`);
    }
  }
}
