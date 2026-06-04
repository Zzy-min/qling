import { SlashCommand } from "./types.js";

export const compactCommand: SlashCommand = {
  name: "/compact",
  description: "手动触发当前上下文压缩",
  usage: "/compact",
  execute: async (_args, context) => {
    if (typeof (context.agentLoop as any).compactSessionNow !== "function") {
      context.writeError("❌ 当前 AgentLoop 不支持手动上下文压缩。");
      return;
    }

    const result = await (context.agentLoop as any).compactSessionNow();
    if (typeof (context.agentLoop as any).checkpointSession === "function") {
      await (context.agentLoop as any).checkpointSession();
    }
    context.writeLine("");
    context.writeLine("🗜️ 【上下文压缩】");
    context.writeLine("-----------------------------------------");
    context.writeLine(`压缩前消息数 : ${result.beforeCount}`);
    context.writeLine(`压缩后消息数 : ${result.afterCount}`);
    context.writeLine(`发生压缩     : ${result.changed ? "是" : "否"}`);
    context.writeLine("-----------------------------------------");
    context.writeLine("");
  },
};
