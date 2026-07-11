// ============================================================
// Phase 3.3+ — browser_act：有限交互 + 跨步会话
// 启用：QLING_BROWSER_ACT=1
// 会话：session 参数（默认 default）；open/close/status
// ============================================================

import type { ToolDefinition, ToolResult } from "../types.js";
import { appendGuardAudit, checkUrlFetchPolicy } from "../guard.js";
import { guardConfigFromEnv } from "../config.js";
import { toolError, toolSuccess } from "./error-utils.js";
import {
  getBrowserSessionPool,
  normalizeSessionId,
} from "./browser-act-session.js";

export type BrowserActAction =
  | "open"
  | "close"
  | "status"
  | "goto"
  | "click"
  | "type"
  | "wait_for"
  | "extract"
  | "press";

const ENABLED_VALUES = new Set(["1", "true", "on", "yes"]);

export function isBrowserActEnabled(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): boolean {
  const raw = String(env.QLING_BROWSER_ACT ?? "").trim().toLowerCase();
  return ENABLED_VALUES.has(raw);
}

export const browserActTool: ToolDefinition = {
  name: "browser_act",
  description:
    "Interactive browser with cross-step sessions (open→goto→click→extract→close). DISABLED by default — QLING_BROWSER_ACT=1. Prefer opencli for social platforms.",
  longDescription: `有限交互浏览器（Playwright）+ **跨步会话**。默认关闭。

**启用**: \`QLING_BROWSER_ACT=1\`

**会话**:
- \`session\` 名（默认 \`default\`）在进程内保活页面
- \`open\` — 打开会话（可选 url）
- \`close\` — 关闭会话
- \`status\` — 列出会话

**动作**:
- goto / click / type / wait_for / extract / press（在已有会话上操作）
- 无会话时：goto 会自动 open；click/type 等需先 open 或 goto

**不要用**: 抖音/小红书等 → opencli；只读文档 → browser_fetch

**安全**: 网络 Guard；Plan Mode 禁止；空闲默认 10min 回收（QLING_BROWSER_ACT_IDLE_TTL_MS）`,
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description:
          "open | close | status | goto | click | type | wait_for | extract | press",
      },
      session: {
        type: "string",
        description: "Session id (default: default). Keeps page across tool calls.",
      },
      url: { type: "string", description: "URL for open/goto (http/https)" },
      selector: { type: "string", description: "CSS selector" },
      text: { type: "string", description: "Text for type" },
      key: { type: "string", description: "Key for press, e.g. Enter" },
      timeout_ms: { type: "number", description: "Step timeout ms (default 15000)" },
    },
    required: ["action"],
  },
  scenes: ["web"],
  priority: 5,
  readOnly: false,
  destructive: false,
  concurrencySafe: false,
  effortHint: "high",
};

function parseTimeout(raw: unknown): number {
  const n = Number(raw ?? 15_000);
  if (!Number.isFinite(n) || n <= 0) return 15_000;
  return Math.min(120_000, Math.floor(n));
}

async function guardUrl(rawUrl: string): Promise<ToolResult | null> {
  const guard = guardConfigFromEnv();
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return toolError("BROWSER_ACT_INVALID_URL", `invalid url: ${rawUrl}`);
  }
  const decision = await checkUrlFetchPolicy(target, guard);
  if (!decision.allowed) {
    await appendGuardAudit(guard, {
      tool: "browser_act",
      action: "deny",
      category: decision.category,
      target: target.toString(),
      reason: decision.reason,
    });
    return toolError(
      "BROWSER_ACT_GUARD_BLOCKED",
      decision.reason ?? "guard denied browser_act",
      { category: "network" }
    );
  }
  return null;
}

async function allowBrowserRequest(rawUrl: string): Promise<boolean> {
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return false;
  }
  if (["about:", "data:", "blob:"].includes(target.protocol)) return true;

  const guard = guardConfigFromEnv();
  const decision = await checkUrlFetchPolicy(target, guard);
  if (decision.allowed) return true;
  await appendGuardAudit(guard, {
    tool: "browser_act",
    action: "deny",
    category: decision.category,
    target: target.toString(),
    reason: decision.reason,
  });
  return false;
}

export async function runBrowserAct(args: {
  action?: string;
  session?: string;
  url?: string;
  selector?: string;
  text?: string;
  key?: string;
  timeout_ms?: number;
}): Promise<ToolResult> {
  if (!isBrowserActEnabled()) {
    return toolError(
      "BROWSER_ACT_DISABLED",
      "browser_act 默认关闭。启用: QLING_BROWSER_ACT=1。平台数据请用 opencli；只读文档用 browser_fetch。见 docs/web-routing.md",
      { category: "permission" }
    );
  }

  const action = String(args.action ?? "").trim().toLowerCase() as BrowserActAction;
  const allowed: BrowserActAction[] = [
    "open",
    "close",
    "status",
    "goto",
    "click",
    "type",
    "wait_for",
    "extract",
    "press",
  ];
  if (!allowed.includes(action)) {
    return toolError(
      "BROWSER_ACT_INVALID_ACTION",
      `action must be one of: ${allowed.join(", ")}`
    );
  }

  const sessionId = normalizeSessionId(args.session);
  const timeout = parseTimeout(args.timeout_ms);
  const pool = getBrowserSessionPool();
  const guard = guardConfigFromEnv();
  const requestGuard = (url: string) => allowBrowserRequest(url);
  let openedForAction = false;

  try {
    if (action === "status") {
      await pool.sweepIdle();
      const list = pool.list();
      if (list.length === 0) {
        return toolSuccess("browser_act sessions: (none)");
      }
      const lines = list.map(
        (s) =>
          `- ${s.id}: url=${s.lastUrl || "(blank)"} idle=${Math.round(s.idleMs / 1000)}s age=${Math.round(s.ageMs / 1000)}s`
      );
      return toolSuccess(`browser_act sessions (${list.length}):\n${lines.join("\n")}`);
    }

    if (action === "close") {
      const ok = await pool.close(sessionId);
      return toolSuccess(
        ok ? `session closed: ${sessionId}` : `session not found: ${sessionId}`
      );
    }

    // open / goto / 交互动作需要会话
    if (action === "open") {
      if (args.url) {
        const blocked = await guardUrl(String(args.url).trim());
        if (blocked) return blocked;
      }
      const existed = pool.has(sessionId);
      const handle = await pool.open(sessionId, requestGuard);
      openedForAction = !existed;
      if (args.url) {
        const rawUrl = String(args.url).trim();
        await handle.page.goto(rawUrl, { waitUntil: "domcontentloaded", timeout });
        pool.touch(sessionId, rawUrl);
        const title = await handle.page.title();
        return toolSuccess(
          `session open: ${sessionId}\ngoto: ${rawUrl}\ntitle: ${title}`
        );
      }
      return toolSuccess(
        `session open: ${sessionId}\nurl: (blank — use action=goto next)`
      );
    }

    // 需要 page 的动作
    if (action === "goto" && !String(args.url ?? "").trim()) {
      return toolError("BROWSER_ACT_MISSING_URL", "url is required for goto");
    }

    const navigationUrl = String(args.url ?? "").trim();
    if (navigationUrl) {
      const blocked = await guardUrl(navigationUrl);
      if (blocked) return blocked;
    }

    let handle = pool.get(sessionId);
    if (!handle) {
      if (action === "goto" || args.url) {
        // 自动 open
        handle = await pool.open(sessionId, requestGuard);
        openedForAction = true;
      } else {
        return toolError(
          "BROWSER_ACT_NO_SESSION",
          `无会话 "${sessionId}"。请先 browser_act action=open 或 action=goto url=...（session 默认 default）`
        );
      }
    } else {
      handle = await pool.open(sessionId, requestGuard);
    }

    if (action === "goto" || (args.url && action !== "extract")) {
      // extract 也可带 url 直接跳转
    }

    if (action === "goto") {
      const rawUrl = navigationUrl;
      await handle.page.goto(rawUrl, { waitUntil: "domcontentloaded", timeout });
      pool.touch(sessionId, rawUrl);
      const title = await handle.page.title();
      await appendGuardAudit(guard, {
        tool: "browser_act",
        action: "allow",
        category: "network",
        target: rawUrl,
      });
      return toolSuccess(
        `goto ok\nsession: ${sessionId}\nurl: ${rawUrl}\ntitle: ${title}`
      );
    }

    // 可选：交互动作若带 url 则先导航
    if (args.url && ["click", "type", "wait_for", "extract", "press"].includes(action)) {
      const rawUrl = navigationUrl;
      await handle.page.goto(rawUrl, { waitUntil: "domcontentloaded", timeout });
      pool.touch(sessionId, rawUrl);
    }

    let output = "";
    switch (action) {
      case "click": {
        const sel = String(args.selector ?? "").trim();
        if (!sel) {
          return toolError("BROWSER_ACT_MISSING_SELECTOR", "selector is required for click");
        }
        await handle.page.click(sel, { timeout });
        pool.touch(sessionId);
        output = `click ok\nsession: ${sessionId}\nselector: ${sel}`;
        break;
      }
      case "type": {
        const sel = String(args.selector ?? "").trim();
        const text = String(args.text ?? "");
        if (!sel) {
          return toolError("BROWSER_ACT_MISSING_SELECTOR", "selector is required for type");
        }
        await handle.page.fill(sel, text, { timeout });
        pool.touch(sessionId);
        output = `type ok\nsession: ${sessionId}\nselector: ${sel}\nchars: ${text.length}`;
        break;
      }
      case "wait_for": {
        const sel = String(args.selector ?? "").trim();
        if (!sel) {
          return toolError("BROWSER_ACT_MISSING_SELECTOR", "selector is required for wait_for");
        }
        await handle.page.waitForSelector(sel, { timeout });
        pool.touch(sessionId);
        output = `wait_for ok\nsession: ${sessionId}\nselector: ${sel}`;
        break;
      }
      case "extract": {
        const sel = String(args.selector ?? "").trim();
        let text: string;
        if (sel) {
          text = await handle.page.locator(sel).innerText({ timeout });
        } else {
          text = await handle.page.evaluate(() => document.body?.innerText ?? "");
        }
        const cleaned = text.replace(/\n\s*\n/g, "\n\n").trim().slice(0, 12_000);
        const title = await handle.page.title();
        const url = handle.page.url();
        pool.touch(sessionId, url);
        output = `extract ok\nsession: ${sessionId}\ntitle: ${title}\nurl: ${url}\n\n${cleaned}`;
        break;
      }
      case "press": {
        const key = String(args.key ?? "").trim();
        if (!key) {
          return toolError("BROWSER_ACT_MISSING_KEY", "key is required for press");
        }
        const sel = String(args.selector ?? "").trim();
        if (sel) {
          await handle.page.focus(sel, { timeout });
        }
        await handle.page.keyboard.press(key);
        pool.touch(sessionId);
        output = `press ok\nsession: ${sessionId}\nkey: ${key}`;
        break;
      }
      default:
        return toolError("BROWSER_ACT_INVALID_ACTION", `unsupported action: ${action}`);
    }

    await appendGuardAudit(guard, {
      tool: "browser_act",
      action: "allow",
      category: "network",
      target: handle.lastUrl || sessionId,
    });

    return toolSuccess(output);
  } catch (err) {
    if (openedForAction) {
      await pool.close(sessionId).catch(() => false);
    }
    const msg = err instanceof Error ? err.message : String(err);
    return toolError("BROWSER_ACT_FAILED", msg, { category: "network", retriable: true });
  }
}
