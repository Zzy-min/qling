import { SlashCommand } from "./types.js";
import { parseCompactArgs } from "../session/compact-args.js";

export const compactCommand: SlashCommand = {
  name: "/compact",
  aliases: ["/压缩"],
  description: "手动压缩上下文；可指定保留条数与主题焦点",
  usage: "/compact [n|--keep n] [主题...|--theme 主题]",
  execute: async (args, context) => {
    if (typeof (context.agentLoop as any).compactSessionNow !== "function") {
      context.writeError("❌ 当前 AgentLoop 不支持手动上下文压缩。");
      return;
    }

    const opts = parseCompactArgs(args);
    const result = await (context.agentLoop as any).compactSessionNow({
      recentKeep: opts.recentKeep,
      theme: opts.theme,
    });
    if (typeof (context.agentLoop as any).checkpointSession === "function") {
      await (context.agentLoop as any).checkpointSession();
    }
    context.writeLine("");
    context.writeLine("🗜️ 【上下文压缩】");
    context.writeLine("-----------------------------------------");
    context.writeLine(`压缩前消息数 : ${result.beforeCount}`);
    context.writeLine(`压缩后消息数 : ${result.afterCount}`);
    context.writeLine(`保留最近条数 : ${result.recentKeep ?? opts.recentKeep}`);
    context.writeLine(`主题焦点     : ${result.theme || opts.theme || "(无)"}`);
    context.writeLine(`发生压缩     : ${result.changed ? "是" : "否"}`);
    context.writeLine("说明         : 旧消息摘要注入；近期消息（含 tool chain）尽量原样保留。");
    context.writeLine("自动压缩     : 默认开启（超阈值每轮前触发）；QLING_AUTO_COMPACT=0 可关");
    context.writeLine("-----------------------------------------");
    context.writeLine("");
  },
};
