import { SlashCommand } from "./types.js";

function formatTime(value: string): string {
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? value : new Date(ts).toLocaleString();
}

export const sessionsCommand: SlashCommand = {
  name: "/sessions",
  description: "列出最近保存的会话快照",
  usage: "/sessions",
  execute: async (_args, context) => {
    const sessions =
      context.listSavedSessions
        ? await context.listSavedSessions()
        : typeof (context.agentLoop as any).listSessionsDetailed === "function"
          ? await (context.agentLoop as any).listSessionsDetailed()
          : null;

    if (!sessions) {
      context.writeError("❌ 当前会话不支持列出历史 session。");
      return;
    }

    context.writeLine("");
    context.writeLine("🗂️ 【已保存会话】");
    context.writeLine("-----------------------------------------");
    if (sessions.length === 0) {
      context.writeLine("(无)");
    } else {
      for (const session of sessions) {
        context.writeLine(`- ${session.name} | ${session.sessionId}`);
        context.writeLine(
          `  更新: ${formatTime(session.updatedAt)} | turns=${session.turnCount} | messages=${session.messageCount}`
        );
      }
    }
    context.writeLine("-----------------------------------------");
    context.writeLine("");
  },
};
