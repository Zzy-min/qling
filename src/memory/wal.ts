// ============================================================
// 轻灵 - WAL (Write-Ahead Log) 追加日志
// JSONL 格式，序列号 + 校验和，支持崩溃恢复
// ============================================================

import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import * as crypto from "crypto";

// --- WAL Entry ---

export interface WALEntry {
  seq: number;
  op: "add" | "remove" | "update" | "compact";
  timestamp: number;
  data: unknown;
  checksum: string;
}

// --- WAL State（内存 + 持久化）---

export interface WALState {
  lastSeq: number;
  lastCheckpointSeq: number;
}

// --- WriteAheadLog ---

export class WriteAheadLog {
  private walPath: string;
  private statePath: string;
  private state: WALState = { lastSeq: 0, lastCheckpointSeq: 0 };
  private initialized = false;

  constructor(walDir: string) {
    this.walPath = path.join(walDir, "wal.jsonl");
    this.statePath = path.join(walDir, "wal-state.json");
  }

  async init(): Promise<WALState> {
    await fs.mkdir(path.dirname(this.walPath), { recursive: true });
    await this.loadState();
    this.initialized = true;
    return { ...this.state };
  }

  async append(op: WALEntry["op"], data: unknown): Promise<number> {
    if (!this.initialized) throw new Error("WAL not initialized");
    this.state.lastSeq++;
    const entry: WALEntry = {
      seq: this.state.lastSeq,
      op,
      timestamp: Date.now(),
      data,
      checksum: this.computeChecksum(this.state.lastSeq, op, data),
    };
    const line = JSON.stringify(entry) + "\n";
    await fs.appendFile(this.walPath, line, "utf-8");
    await this.saveState();
    return this.state.lastSeq;
  }

  async readEntries(fromSeq: number): Promise<WALEntry[]> {
    if (!fsSync.existsSync(this.walPath)) return [];
    const raw = await fs.readFile(this.walPath, "utf-8");
    if (!raw.trim()) return [];
    const entries: WALEntry[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const entry = JSON.parse(trimmed) as WALEntry;
        if (entry.seq >= fromSeq) {
          if (!this.verifyChecksum(entry)) {
            console.error(`[WAL] checksum mismatch on seq=${entry.seq}, skipping`);
            continue;
          }
          entries.push(entry);
        }
      } catch {
        // skip corrupted lines
      }
    }
    return entries.sort((a, b) => a.seq - b.seq);
  }

  async checkpoint(checkpointData: unknown): Promise<void> {
    if (!this.initialized) throw new Error("WAL not initialized");
    const checkpointPath = path.join(path.dirname(this.walPath), "memory.json");
    await fs.writeFile(checkpointPath, JSON.stringify(checkpointData, null, 2), "utf-8");
    this.state.lastCheckpointSeq = this.state.lastSeq;
    await this.saveState();
    // truncate WAL: keep only entries after checkpoint
    await this.truncateBeforeCheckpoint();
  }

  async close(): Promise<void> {
    this.initialized = false;
  }

  getLastSeq(): number {
    return this.state.lastSeq;
  }

  getLastCheckpointSeq(): number {
    return this.state.lastCheckpointSeq;
  }

  isDirty(): boolean {
    return this.state.lastSeq > this.state.lastCheckpointSeq;
  }

  getPendingCount(): number {
    return this.state.lastSeq - this.state.lastCheckpointSeq;
  }

  // --- Private ---

  private computeChecksum(seq: number, op: string, data: unknown): string {
    const raw = seq + ":" + op + ":" + JSON.stringify(data);
    return crypto.createHash("md5").update(raw).digest("hex").slice(0, 12);
  }

  private verifyChecksum(entry: WALEntry): boolean {
    return entry.checksum === this.computeChecksum(entry.seq, entry.op, entry.data);
  }

  private async loadState(): Promise<void> {
    try {
      const raw = await fs.readFile(this.statePath, "utf-8");
      const parsed = JSON.parse(raw) as WALState;
      this.state.lastSeq = parsed.lastSeq ?? 0;
      this.state.lastCheckpointSeq = parsed.lastCheckpointSeq ?? 0;
      // also scan WAL file for actual max seq (in case state was lost)
      if (fsSync.existsSync(this.walPath)) {
        const entries = await this.readEntries(0);
        for (const entry of entries) {
          if (entry.seq > this.state.lastSeq) {
            this.state.lastSeq = entry.seq;
          }
        }
      }
    } catch {
      this.state = { lastSeq: 0, lastCheckpointSeq: 0 };
    }
  }

  private async saveState(): Promise<void> {
    await fs.writeFile(
      this.statePath,
      JSON.stringify(this.state, null, 2),
      "utf-8"
    );
  }

  private async truncateBeforeCheckpoint(): Promise<void> {
    if (!fsSync.existsSync(this.walPath)) return;
    const entries = await this.readEntries(this.state.lastCheckpointSeq + 1);
    const lines = entries.map((e) => JSON.stringify(e)).join("\n");
    await fs.writeFile(this.walPath, lines + (lines ? "\n" : ""), "utf-8");
  }
}
