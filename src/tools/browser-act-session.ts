// ============================================================
// browser_act 跨步会话：进程内 Playwright page 保活
// ============================================================

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export interface BrowserSessionHandle {
  id: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  lastUrl: string;
  createdAt: number;
  lastUsedAt: number;
  requestGuardInstalled: boolean;
}

export type BrowserRequestGuard = (url: string) => Promise<boolean>;

export interface BrowserSessionPoolOptions {
  /** 最大并发会话数 */
  maxSessions?: number;
  /** 空闲超时 ms，超过则自动关闭 */
  idleTtlMs?: number;
  /** 注入的 launch 工厂（测试用） */
  launchBrowser?: () => Promise<Browser>;
}

const DEFAULT_MAX = 3;
const DEFAULT_IDLE_TTL_MS = 10 * 60 * 1000;

function resolveMaxSessions(env = process.env): number {
  const n = Number(env.QLING_BROWSER_ACT_MAX_SESSIONS ?? DEFAULT_MAX);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX;
  return Math.min(8, Math.floor(n));
}

function resolveIdleTtlMs(env = process.env): number {
  const n = Number(env.QLING_BROWSER_ACT_IDLE_TTL_MS ?? DEFAULT_IDLE_TTL_MS);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_IDLE_TTL_MS;
  return Math.floor(n);
}

export class BrowserSessionPool {
  private sessions = new Map<string, BrowserSessionHandle>();
  private maxSessions: number;
  private idleTtlMs: number;
  private launchBrowser: () => Promise<Browser>;

  constructor(options: BrowserSessionPoolOptions = {}) {
    this.maxSessions = options.maxSessions ?? resolveMaxSessions();
    this.idleTtlMs = options.idleTtlMs ?? resolveIdleTtlMs();
    this.launchBrowser =
      options.launchBrowser ??
      (() =>
        chromium.launch({
          headless: true,
        }));
  }

  list(): Array<{ id: string; lastUrl: string; ageMs: number; idleMs: number }> {
    const now = Date.now();
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      lastUrl: s.lastUrl,
      ageMs: now - s.createdAt,
      idleMs: now - s.lastUsedAt,
    }));
  }

  has(id: string): boolean {
    return this.sessions.has(id);
  }

  get(id: string): BrowserSessionHandle | undefined {
    return this.sessions.get(id);
  }

  /** 关闭并移除空闲超时会话 */
  async sweepIdle(now = Date.now()): Promise<string[]> {
    if (this.idleTtlMs <= 0) return [];
    const closed: string[] = [];
    for (const [id, s] of this.sessions) {
      if (now - s.lastUsedAt >= this.idleTtlMs) {
        await this.close(id);
        closed.push(id);
      }
    }
    return closed;
  }

  async open(id: string, requestGuard?: BrowserRequestGuard): Promise<BrowserSessionHandle> {
    await this.sweepIdle();
    const existing = this.sessions.get(id);
    if (existing) {
      if (requestGuard && !existing.requestGuardInstalled) {
        await this.installRequestGuard(existing.context, requestGuard);
        existing.requestGuardInstalled = true;
      }
      existing.lastUsedAt = Date.now();
      return existing;
    }

    if (this.sessions.size >= this.maxSessions) {
      // 驱逐最久未用
      let oldestId: string | null = null;
      let oldest = Infinity;
      for (const [sid, s] of this.sessions) {
        if (s.lastUsedAt < oldest) {
          oldest = s.lastUsedAt;
          oldestId = sid;
        }
      }
      if (oldestId) await this.close(oldestId);
    }

    const browser = await this.launchBrowser();
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    if (requestGuard) {
      await this.installRequestGuard(context, requestGuard);
    }
    const page = await context.newPage();
    const now = Date.now();
    const handle: BrowserSessionHandle = {
      id,
      browser,
      context,
      page,
      lastUrl: "",
      createdAt: now,
      lastUsedAt: now,
      requestGuardInstalled: Boolean(requestGuard),
    };
    this.sessions.set(id, handle);
    return handle;
  }

  private async installRequestGuard(
    context: BrowserContext,
    requestGuard: BrowserRequestGuard
  ): Promise<void> {
    await context.route("**/*", async (route) => {
      let allowed = false;
      try {
        allowed = await requestGuard(route.request().url());
      } catch {
        allowed = false;
      }
      if (allowed) await route.continue();
      else await route.abort("blockedbyclient");
    });
  }

  touch(id: string, lastUrl?: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.lastUsedAt = Date.now();
    if (lastUrl !== undefined) s.lastUrl = lastUrl;
  }

  async close(id: string): Promise<boolean> {
    const s = this.sessions.get(id);
    if (!s) return false;
    this.sessions.delete(id);
    await s.browser.close().catch(() => undefined);
    return true;
  }

  async closeAll(): Promise<void> {
    const ids = Array.from(this.sessions.keys());
    for (const id of ids) {
      await this.close(id);
    }
  }

  size(): number {
    return this.sessions.size;
  }
}

/** 进程内默认池（browser_act 共用） */
let defaultPool: BrowserSessionPool | null = null;

export function getBrowserSessionPool(): BrowserSessionPool {
  if (!defaultPool) defaultPool = new BrowserSessionPool();
  return defaultPool;
}

/** 测试用：替换 / 清空默认池 */
export function resetBrowserSessionPool(pool?: BrowserSessionPool | null): void {
  if (defaultPool) {
    void defaultPool.closeAll();
  }
  defaultPool = pool === undefined ? null : pool;
}

export function normalizeSessionId(raw: unknown): string {
  const s = String(raw ?? "default").trim();
  if (!s) return "default";
  // 防止路径穿越式 id
  return s.replace(/[^\w.-]+/g, "_").slice(0, 64) || "default";
}
