import type { SlashCommand } from "./types.js";

type PermissionMode = "allow" | "deny" | "ask";

interface ModeAgentLoop {
  isPlanMode?: () => boolean;
  setPlanMode?: (enabled: boolean) => void;
  getPermissionMode?: () => PermissionMode;
  setPermissionMode?: (mode: PermissionMode) => void;
}

export interface AgentModeSnapshot {
  sessionMode: "agent" | "plan";
  permissionMode: PermissionMode;
}

function readMode(loop: ModeAgentLoop): AgentModeSnapshot {
  return {
    sessionMode: loop.isPlanMode?.() ? "plan" : "agent",
    permissionMode: loop.getPermissionMode?.() ?? "ask",
  };
}

export function cycleAgentMode(loop: ModeAgentLoop): AgentModeSnapshot {
  const current = readMode(loop);
  let next: AgentModeSnapshot;

  if (current.sessionMode === "plan") {
    next = { sessionMode: "agent", permissionMode: "allow" };
  } else if (current.permissionMode === "allow") {
    next = { sessionMode: "agent", permissionMode: "ask" };
  } else {
    next = { sessionMode: "plan", permissionMode: "ask" };
  }

  loop.setPlanMode?.(next.sessionMode === "plan");
  loop.setPermissionMode?.(next.permissionMode);
  process.env.QLING_PLAN_MODE = next.sessionMode === "plan" ? "1" : "0";
  process.env.QLING_GUARD_PERMISSIONS_DEFAULT = next.permissionMode;
  process.env.QLING_PERMISSIONS_MODE = next.permissionMode;
  return next;
}

function modeLabel(mode: AgentModeSnapshot): string {
  if (mode.sessionMode === "plan") return "Plan / ask（只读规划）";
  if (mode.permissionMode === "allow") return "Agent / allow（Always Agree）";
  if (mode.permissionMode === "deny") return "Agent / deny（默认拒绝）";
  return "Agent / ask（逐次确认）";
}

function writeMode(context: Parameters<SlashCommand["execute"]>[1], mode: AgentModeSnapshot): void {
  context.writeLine("");
  context.writeLine(`⇧ 模式已切换为: ${modeLabel(mode)}`);
  context.writeLine("循环顺序: Agent/ask → Plan → Agent/allow → Agent/ask");
  context.writeLine("边界: 仅当前进程生效；Plan Mode 始终拒绝写工具。");
  context.writeLine("");
}

export const modeCommand: SlashCommand = {
  name: "/mode",
  aliases: ["/模式"],
  description: "查看或循环 Agent、Plan 与 Always Agree 模式",
  usage: "/mode [status|cycle]",
  category: "session",
  argumentHint: "[status|cycle]",
  examples: ["/mode", "/mode cycle", "/模式 cycle"],
  execute: async (args, context) => {
    const loop = context.agentLoop as ModeAgentLoop;
    const action = (args[0] ?? "status").toLowerCase();
    if (typeof loop.setPlanMode !== "function" || typeof loop.setPermissionMode !== "function") {
      context.writeError("❌ 当前 AgentLoop 不支持模式切换。");
      return;
    }
    if (action === "status" || action === "状态") {
      writeMode(context, readMode(loop));
      return;
    }
    if (action !== "cycle" && action !== "循环" && action !== "next") {
      context.writeError("❌ 用法: /mode [status|cycle]");
      return;
    }
    writeMode(context, cycleAgentMode(loop));
  },
};
