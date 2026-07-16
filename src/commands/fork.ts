import { SlashCommand } from "./types.js";

export const forkCommand: SlashCommand = {
  name: "/fork",
  aliases: ["/分叉"],
  description: "将当前对话分叉为新 session（复制消息，新 sessionId）",
  usage: "/fork [name]",
  category: "session",
  availability: "local",
  execute: async (args, context) => {
    const nameHint = args.join(" ").trim() || undefined;
    const agent = context.agentLoop as {
      forkSession?: (name?: string) => Promise<{
        name: string;
        title: string;
        sessionId: string;
        messageCount: number;
        turnCount: number;
        forkedFrom: string;
      }>;
      getModel?: () => string;
    };

    if (typeof agent.forkSession !== "function") {
      context.writeError("❌ 当前 AgentLoop 不支持 /fork。");
      return;
    }

    const forked = await agent.forkSession(nameHint);
    if (typeof context.onModelChanged === "function" && typeof agent.getModel === "function") {
      await context.onModelChanged(agent.getModel());
    }

    context.writeLine("");
    context.writeLine("🌿 【会话已分叉】");
    context.writeLine("-----------------------------------------");
    context.writeLine(`新 Session  : ${forked.sessionId}`);
    context.writeLine(`保存名      : ${forked.name}`);
    context.writeLine(`标题        : ${forked.title || forked.name}`);
    context.writeLine(`来源        : ${forked.forkedFrom}`);
    context.writeLine(`消息/轮次   : ${forked.messageCount} / ${forked.turnCount}`);
    context.writeLine("说明        : 消息已复制；后续对话写入新 session，不覆盖源会话历史。");
    context.writeLine("-----------------------------------------");
    context.writeLine("");
  },
};
