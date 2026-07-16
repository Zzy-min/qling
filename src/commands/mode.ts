import type { SlashCommand } from "./types.js";
import {
  modeCapabilities,
  parseGrokUiMode,
  resolveGrokUiMode,
  uiModeToSnapshot,
  type GrokUiMode,
} from "../tui/mode-chrome.js";
import { openOptionPickerOrFallback } from "../tui/option-picker-helpers.js";

export type { GrokUiMode };
export { resolveGrokUiMode, modeCapabilities, parseGrokUiMode };

type PermissionMode = "allow" | "deny" | "ask";

/**
 * Grok Build session modes (Shift+Tab cycle):
 *   Normal → Plan → Always-approve → Normal
 */
interface ModeAgentLoop {
  isPlanMode?: () => boolean;
  setPlanMode?: (enabled: boolean) => void;
  getPermissionMode?: () => PermissionMode;
  setPermissionMode?: (mode: PermissionMode) => void;
  getWorkspaceDir?: () => string;
}

export interface AgentModeSnapshot {
  sessionMode: "agent" | "plan";
  permissionMode: PermissionMode;
  /** 顶栏/输入框统一展示名 */
  uiMode: GrokUiMode;
}

export function readMode(loop: ModeAgentLoop): AgentModeSnapshot {
  const sessionMode = loop.isPlanMode?.() ? "plan" : "agent";
  const permissionMode = loop.getPermissionMode?.() ?? "ask";
  return {
    sessionMode,
    permissionMode,
    uiMode: resolveGrokUiMode(sessionMode, permissionMode),
  };
}

function applyModeToLoop(loop: ModeAgentLoop, next: AgentModeSnapshot): AgentModeSnapshot {
  loop.setPlanMode?.(next.sessionMode === "plan");
  loop.setPermissionMode?.(next.permissionMode);
  process.env.QLING_PLAN_MODE = next.sessionMode === "plan" ? "1" : "0";
  process.env.QLING_GUARD_PERMISSIONS_DEFAULT = next.permissionMode;
  process.env.QLING_PERMISSIONS_MODE = next.permissionMode;
  return next;
}

/**
 * 直接设置 Grok UI 模式（normal | plan | auto）。
 */
export function setAgentMode(loop: ModeAgentLoop, uiMode: GrokUiMode): AgentModeSnapshot {
  const mapped = uiModeToSnapshot(uiMode);
  return applyModeToLoop(loop, {
    sessionMode: mapped.sessionMode,
    permissionMode: mapped.permissionMode,
    uiMode: mapped.uiMode,
  });
}

/**
 * Shift+Tab 循环（与 Grok 一致）:
 *   normal → plan → auto (always-approve) → normal
 */
export function cycleAgentMode(loop: ModeAgentLoop): AgentModeSnapshot {
  const current = readMode(loop);
  const order: GrokUiMode[] = ["normal", "plan", "auto"];
  const idx = order.indexOf(current.uiMode);
  const nextUi = order[(idx + 1) % order.length]!;
  return setAgentMode(loop, nextUi);
}

/** 紧凑一行：Mode: normal | plan | auto · 能力摘要 */
export function formatModeChromeLine(mode: AgentModeSnapshot): string {
  const cap = modeCapabilities(mode.uiMode);
  return `Mode: ${mode.uiMode} · ${cap.summary}`;
}

function writeMode(context: Parameters<SlashCommand["execute"]>[1], mode: AgentModeSnapshot): void {
  const apply = (
    context as {
      applySessionChrome?: (p: {
        sessionMode?: string;
        permissionMode?: string;
      }) => void;
    }
  ).applySessionChrome;
  if (typeof apply === "function") {
    apply({
      sessionMode: mode.sessionMode,
      permissionMode: mode.permissionMode,
    });
    // applySessionChrome 已刷新顶栏 Mode + 输入框；勿再 writeLine 叠字
    return;
  }
  context.writeLine(formatModeChromeLine(mode));
}

async function ensurePlanDirIfNeeded(
  context: Parameters<SlashCommand["execute"]>[1],
  loop: ModeAgentLoop,
  mode: AgentModeSnapshot
): Promise<void> {
  if (mode.uiMode !== "plan") return;
  try {
    const { ensureDefaultPlanDir } = await import("../plan/plan-artifacts.js");
    const workspace =
      context.workspaceDir ||
      (typeof loop.getWorkspaceDir === "function" ? loop.getWorkspaceDir() : "") ||
      process.cwd();
    await ensureDefaultPlanDir(workspace);
  } catch {
    // 目录创建失败不阻塞模式切换
  }
}

async function executeModeSwitch(
  context: Parameters<SlashCommand["execute"]>[1],
  loop: ModeAgentLoop,
  mode: AgentModeSnapshot
): Promise<void> {
  await ensurePlanDirIfNeeded(context, loop, mode);
  writeMode(context, mode);
}

async function runModeCommand(
  args: string[],
  context: Parameters<SlashCommand["execute"]>[1],
  opts: { forceUiMode?: GrokUiMode } = {}
): Promise<void> {
  const loop = context.agentLoop as ModeAgentLoop;
  if (typeof loop.setPlanMode !== "function" || typeof loop.setPermissionMode !== "function") {
    context.writeError("Mode switch unavailable");
    return;
  }

  if (opts.forceUiMode) {
    await executeModeSwitch(context, loop, setAgentMode(loop, opts.forceUiMode));
    return;
  }

  const raw = (args[0] ?? "").toLowerCase();

  // 默认 / status / pick → 三态切换器（Shift+Tab 仍可循环）
  if (!raw || raw === "status" || raw === "状态" || raw === "pick" || raw === "ui" || raw === "list") {
    const current = readMode(loop);
    const opened = openOptionPickerOrFallback(
      context,
      {
        title: "模式切换 · Mode",
        footerHint: "↑/↓ 选择 · Enter 应用 · Esc 取消 · 亦可用 Shift+Tab",
        selectedId: current.uiMode,
        items: (["normal", "plan", "auto"] as GrokUiMode[]).map((id) => {
          const cap = modeCapabilities(id);
          return {
            id,
            label: id,
            description: cap.summary,
            active: id === current.uiMode,
          };
        }),
        onPick: async (item) => {
          const next = parseGrokUiMode(item.id);
          if (!next) return;
          await executeModeSwitch(context, loop, setAgentMode(loop, next));
        },
      },
      () => writeMode(context, current)
    );
    if (!opened) {
      // fallback 已 writeMode
    }
    return;
  }

  if (raw === "cycle" || raw === "循环" || raw === "next") {
    await executeModeSwitch(context, loop, cycleAgentMode(loop));
    return;
  }

  const direct = parseGrokUiMode(raw);
  if (direct) {
    await executeModeSwitch(context, loop, setAgentMode(loop, direct));
    return;
  }

  context.writeError("Usage: /mode [status|cycle|normal|plan|auto]");
}

export const modeCommand: SlashCommand = {
  name: "/mode",
  aliases: ["/模式"],
  description: "Grok 三态：Normal → Plan → Always-approve（Shift+Tab）",
  usage: "/mode [status|cycle|normal|plan|auto]",
  category: "session",
  argumentHint: "[status|cycle|normal|plan|auto]",
  examples: ["/mode", "/mode cycle", "/mode plan", "/mode auto", "/always-approve"],
  execute: async (args, context) => runModeCommand(args, context),
};

/** Grok Always-approve 快捷入口 */
export const alwaysApproveCommand: SlashCommand = {
  name: "/always-approve",
  aliases: ["/alwaysapprove", "/auto-mode", "/免确认"],
  description: "切换到 auto（Always-approve：工具默认免确认）",
  usage: "/always-approve",
  category: "session",
  examples: ["/always-approve", "/auto-mode"],
  execute: async (_args, context) => runModeCommand([], context, { forceUiMode: "auto" }),
};
