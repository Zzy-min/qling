import { SlashCommand } from "./types.js";

function formatTime(value: string): string {
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? value : new Date(ts).toLocaleString();
}

export const sessionsCommand: SlashCommand = {
  name: "/sessions",
  aliases: ["/会话", "/session-picker"],
  description: "打开会话切换器，或列出最近保存的会话",
  usage: "/sessions [list|pick]",
  execute: async (args, context) => {
    const sub = (args[0] ?? "pick").toLowerCase();

    // 默认 / 显式 pick：TUI 内切换器（与 /resume 一致；勿 writeLine 以免叠画）
    if (
      (sub === "pick" || sub === "ui" || sub === "切换" || args.length === 0) &&
      typeof context.openSessionPicker === "function"
    ) {
      context.openSessionPicker();
      return;
    }

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
        const title = (session as { title?: string }).title || session.name;
        context.writeLine(`- ${title}`);
        context.writeLine(
          `  id: ${session.sessionId} | 更新: ${formatTime(session.updatedAt)} | turns=${session.turnCount} | messages=${session.messageCount}`
        );
      }
    }
    context.writeLine("-----------------------------------------");
    context.writeLine("提示: /sessions pick 或 Ctrl+\\ 打开切换器；/resume <id> 直接恢复");
    context.writeLine("");
  },
};
