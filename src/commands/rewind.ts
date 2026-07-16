import { SlashCommand } from "./types.js";
import { resolveRewindTurns } from "../session/session-lifecycle.js";

export const rewindCommand: SlashCommand = {
  name: "/rewind",
  aliases: ["/undo", "/回退"],
  description: "回退最近 n 个用户轮（含对应助手/工具消息）并保存",
  usage: "/rewind [n]",
  category: "session",
  availability: "local",
  claudeCompatibleName: "/rewind",
  execute: async (args, context) => {
    const n = resolveRewindTurns(args, 1);
    const agent = context.agentLoop as {
      rewindTurns?: (turns: number) => Promise<{
        removedTurns: number;
        removedMessages: number;
        remainingTurns: number;
        messageCount: number;
        turnCount: number;
      }>;
    };

    if (typeof agent.rewindTurns !== "function") {
      context.writeError("❌ 当前 AgentLoop 不支持 /rewind。");
      return;
    }

    const result = await agent.rewindTurns(n);
    context.writeLine("");
    context.writeLine("⏪ 【会话回退】");
    context.writeLine("-----------------------------------------");
    if (result.removedTurns === 0) {
      context.writeLine("无可回退的用户轮（会话为空或 n 无效）。");
    } else {
      context.writeLine(`已回退用户轮 : ${result.removedTurns}`);
      context.writeLine(`删除消息数   : ${result.removedMessages}`);
      context.writeLine(`剩余用户轮   : ${result.remainingTurns}`);
      context.writeLine(`当前消息数   : ${result.messageCount}`);
      context.writeLine(`turnCount    : ${result.turnCount}`);
      context.writeLine("已 checkpoint 到当前 session 快照。");
    }
    context.writeLine("边界        : 只改本地会话消息，不回滚磁盘代码/工作区文件。");
    context.writeLine("-----------------------------------------");
    context.writeLine("");
  },
};
