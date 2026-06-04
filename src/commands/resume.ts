import { SlashCommand } from "./types.js";

function normalizeTarget(args: string[]): string | undefined {
  const raw = args.join(" ").trim();
  if (!raw) return undefined;
  const normalized = raw.toLowerCase();
  if (normalized === "latest" || normalized === "last" || normalized === "continue") {
    return undefined;
  }
  return raw;
}

export const resumeCommand: SlashCommand = {
  name: "/resume",
  description: "恢复最近一次或指定会话",
  usage: "/resume [session|latest]",
  execute: async (args, context) => {
    const target = normalizeTarget(args);
    let restored =
      context.switchSession
        ? await context.switchSession(target)
        : target
          ? await (context.agentLoop as any).restoreSession?.(target)
          : await (context.agentLoop as any).restoreLatestSession?.();

    if (!restored) {
      context.writeError(target ? `❌ 找不到会话: ${target}` : "❌ 没有可恢复的最近会话。");
      return;
    }

    context.writeLine("");
    context.writeLine("♻️ 【会话已恢复】");
    context.writeLine("-----------------------------------------");
    context.writeLine(`名称       : ${restored.name}`);
    context.writeLine(`Session ID : ${restored.sessionId}`);
    context.writeLine(`Turns      : ${restored.turnCount}`);
    context.writeLine(`Messages   : ${restored.messageCount}`);
    if ("activeTaskCount" in restored) {
      context.writeLine(`Loop Tasks : ${restored.activeTaskCount ?? 0}`);
    }
    if ("activeGoalStatus" in restored && restored.activeGoalStatus) {
      context.writeLine(`Goal       : ${restored.activeGoalStatus}`);
    }
    context.writeLine("-----------------------------------------");
    context.writeLine("");
  },
};
