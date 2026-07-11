// ============================================================
// 轻灵 - Metrics Collector（JSONL 指标收集器）
// ============================================================

import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import type { MetricEvent, MetricsQuery } from "./types.js";

export class MetricsCollector {
  private metricsDir: string;
  private buffer: MetricEvent[] = [];
  private sessionId: string;
  private flushIntervalMs: number;

  constructor(metricsDir: string, sessionId: string, flushIntervalMs: number = 10_000) {
    this.metricsDir = metricsDir;
    this.sessionId = sessionId;
    this.flushIntervalMs = flushIntervalMs;
  }

  async init(): Promise<void> {
    await fs.mkdir(this.metricsDir, { recursive: true });
  }

  record(event: Omit<MetricEvent, "ts" | "session_id">): void {
    this.buffer.push({
      ...event,
      ts: Date.now(),
      session_id: this.sessionId,
    });
    if (this.buffer.length >= 100) {
      // auto-flush when buffer is large
      this.flush().catch(() => {});
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const events = [...this.buffer];
    this.buffer = [];

    const date = new Date().toISOString().slice(0, 10);
    const filePath = path.join(this.metricsDir, `metrics-${date}.jsonl`);
    const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";

    try {
      await fs.appendFile(filePath, lines, "utf-8");
    } catch (err) {
      // put events back in buffer
      this.buffer.unshift(...events);
      console.error("[Metrics] flush failed: " + (err as Error).message);
    }
  }

  async query(query: MetricsQuery): Promise<MetricEvent[]> {
    if (!fsSync.existsSync(this.metricsDir)) return [];

    const files = await fs.readdir(this.metricsDir);
    const jsonlFiles = files.filter((f) => f.startsWith("metrics-") && f.endsWith(".jsonl")).sort().reverse();

    const results: MetricEvent[] = [];
    for (const file of jsonlFiles) {
      if (query.limit && results.length >= query.limit) break;
      const filePath = path.join(this.metricsDir, file);
      const raw = await fs.readFile(filePath, "utf-8");
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed) as MetricEvent;
          if (this.matchesQuery(event, query)) {
            results.push(event);
          }
        } catch {
          // skip
        }
      }
    }

    if (query.limit) return results.slice(0, query.limit);
    return results;
  }

  async queryRecent(options: MetricsQuery & {
    maxScanBytes?: number;
  }): Promise<{ events: MetricEvent[]; scannedBytes: number; truncated: boolean }> {
    const limit = Math.min(100, Math.max(1, Math.floor(options.limit ?? 20)));
    const maxScanBytes = Math.min(
      8 * 1024 * 1024,
      Math.max(1024, Math.floor(options.maxScanBytes ?? 1024 * 1024))
    );
    const events = this.buffer
      .filter((event) => this.matchesQuery(event, options))
      .sort((a, b) => b.ts - a.ts);

    let scannedBytes = 0;
    let truncated = false;
    if (events.length < limit && fsSync.existsSync(this.metricsDir)) {
      const files = (await fs.readdir(this.metricsDir))
        .filter((file) => file.startsWith("metrics-") && file.endsWith(".jsonl"))
        .sort()
        .reverse();

      for (const file of files) {
        if (events.length >= limit || scannedBytes >= maxScanBytes) break;
        const filePath = path.join(this.metricsDir, file);
        const stat = await fs.stat(filePath);
        const bytesToRead = Math.min(stat.size, maxScanBytes - scannedBytes);
        if (bytesToRead <= 0) break;

        const start = Math.max(0, stat.size - bytesToRead);
        const handle = await fs.open(filePath, "r");
        try {
          const buffer = Buffer.alloc(bytesToRead);
          const { bytesRead } = await handle.read(buffer, 0, bytesToRead, start);
          scannedBytes += bytesRead;
          let text = buffer.subarray(0, bytesRead).toString("utf-8");
          if (start > 0) {
            const firstBreak = text.indexOf("\n");
            text = firstBreak >= 0 ? text.slice(firstBreak + 1) : "";
            truncated = true;
          }
          const lines = text.split(/\r?\n/).filter(Boolean).reverse();
          for (const line of lines) {
            if (events.length >= limit) break;
            try {
              const event = JSON.parse(line) as MetricEvent;
              if (this.matchesQuery(event, options)) events.push(event);
            } catch {
              // Ignore incomplete or invalid JSONL records.
            }
          }
        } finally {
          await handle.close();
        }
      }
      if (scannedBytes >= maxScanBytes) truncated = true;
    }

    return {
      events: events.sort((a, b) => b.ts - a.ts).slice(0, limit),
      scannedBytes,
      truncated,
    };
  }

  startAutoFlush(): ReturnType<typeof setInterval> {
    return setInterval(() => {
      this.flush().catch(() => {});
    }, this.flushIntervalMs);
  }

  stopAutoFlush(timer: ReturnType<typeof setInterval>): void {
    clearInterval(timer);
  }

  async purgeOldEntries(retentionDays: number): Promise<number> {
    if (retentionDays <= 0) return 0;
    if (!fsSync.existsSync(this.metricsDir)) return 0;

    const cutoff = Date.now() - retentionDays * 86_400_000;
    const files = await fs.readdir(this.metricsDir);
    const jsonlFiles = files.filter((f) => f.startsWith("metrics-") && f.endsWith(".jsonl"));

    let purged = 0;
    for (const file of jsonlFiles) {
      const filePath = path.join(this.metricsDir, file);
      const raw = await fs.readFile(filePath, "utf-8");
      const lines = raw.split("\n");
      const kept: string[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed) as MetricEvent;
          if (event.ts >= cutoff) {
            kept.push(trimmed);
          } else {
            purged++;
          }
        } catch {
          kept.push(trimmed);
        }
      }

      if (kept.length === 0) {
        await fs.unlink(filePath);
      } else {
        await fs.writeFile(filePath, kept.join("\n") + "\n", "utf-8");
      }
    }
    return purged;
  }

  private matchesQuery(event: MetricEvent, query: MetricsQuery): boolean {
    if (query.type && event.type !== query.type) return false;
    if (query.session_id && event.session_id !== query.session_id) return false;
    if (query.from && event.ts < query.from) return false;
    if (query.to && event.ts > query.to) return false;
    return true;
  }
}
