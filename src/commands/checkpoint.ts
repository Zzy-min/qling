import { SlashCommand } from "./types.js";

function parseArgs(args: string[]): { name?: string; force: boolean } {
  const name = args.filter((arg) => arg !== "--force" && arg !== "-f").join(" ").trim();
  return {
    name: name || undefined,
    force: args.includes("--force") || args.includes("-f"),
  };
}

export const checkpointCommand: SlashCommand = {
  name: "/checkpoint",
  aliases: ["/检查点"],
  description: "保存当前会话为本地恢复检查点",
  usage: "/checkpoint [name] [--force]",
  execute: async (args, context) => {
    const { name, force } = parseArgs(args);
    const saveSession = (context.agentLoop as any).saveSession;
    const checkpointSession = (context.agentLoop as any).checkpointSession;

    if (typeof saveSession !== "function" && typeof checkpointSession !== "function") {
      context.writeError("❌ 当前会话不支持保存本地检查点。");
      return;
    }

    if (name && !force) {
      const sessions =
        context.listSavedSessions
          ? await context.listSavedSessions()
          : typeof (context.agentLoop as any).listSessionsDetailed === "function"
            ? await (context.agentLoop as any).listSessionsDetailed()
            : null;
      if (sessions?.some((session: any) => session.name === name)) {
        context.writeError(`❌ 本地检查点已存在: ${name}。如需覆盖，请显式添加 --force。`);
        return;
      }
    }

    const savedPath =
      typeof saveSession === "function"
        ? await saveSession.call(context.agentLoop, name)
        : await checkpointSession.call(context.agentLoop);
    const stats =
      typeof (context.agentLoop as any).getSessionStats === "function"
        ? (context.agentLoop as any).getSessionStats()
        : null;

    context.writeLine("");
    context.writeLine("💾 【会话检查点已保存】");
    context.writeLine("-----------------------------------------");
    context.writeLine(`Path       : ${savedPath}`);
    if (stats) {
      context.writeLine(`Session ID : ${stats.sessionId}`);
      context.writeLine(`Turns      : ${stats.turnCount}`);
      context.writeLine(`Tokens     : ${stats.tokens}`);
      context.writeLine(`Compactions: ${stats.compactions}`);
    }
    context.writeLine("Boundary   : 本地保存；不调用模型、不联网、不上传会话。");
    context.writeLine("-----------------------------------------");
    context.writeLine("");
  },
};
