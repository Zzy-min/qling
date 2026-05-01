// ============================================================
// 轻灵 - Guard M2: 滑动窗口速率限制器
// per (tool, session) 维度，60s 窗口
// ============================================================

interface WindowEntry {
  timestamps: number[];
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs?: number;
}

export class RateLimiter {
  private windowMs: number;
  private maxPerWindow: number;
  private windows = new Map<string, WindowEntry>();

  constructor(maxPerMinute: number = 30, windowMs: number = 60_000) {
    this.maxPerWindow = maxPerMinute;
    this.windowMs = windowMs;
  }

  check(tool: string, sessionId: string): RateLimitResult {
    const key = tool + ":" + sessionId;
    const now = Date.now();
    const cutoff = now - this.windowMs;

    let entry = this.windows.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      this.windows.set(key, entry);
    }

    // Prune expired timestamps
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

    if (entry.timestamps.length >= this.maxPerWindow) {
      const oldest = entry.timestamps[0];
      const retryAfterMs = oldest + this.windowMs - now;
      return { allowed: false, retryAfterMs: Math.max(0, retryAfterMs) };
    }

    entry.timestamps.push(now);
    return { allowed: true };
  }

  reset(tool?: string, sessionId?: string): void {
    if (!tool && !sessionId) {
      this.windows.clear();
      return;
    }
    for (const key of this.windows.keys()) {
      const [t, s] = key.split(":");
      if ((!tool || t === tool) && (!sessionId || s === sessionId)) {
        this.windows.delete(key);
      }
    }
  }

  getWindowSize(): number {
    return this.windows.size;
  }
}
