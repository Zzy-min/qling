import { SlashCommand } from "./types.js";

export const clearCommand: SlashCommand = {
  name: "/clear",
  aliases: ["/reset"],
  description: "清空当前对话上下文记忆",
  usage: "/clear",
  execute: async (_args, context) => {
    (context.agentLoop as any).reset();
    if (context.goalController && typeof (context.goalController as any).clearGoal === "function") {
      await (context.goalController as any).clearGoal("conversation_reset");
    }
    const canceled = context.scheduler && typeof (context.scheduler as any).cancelAllTasks === "function"
      ? await (context.scheduler as any).cancelAllTasks()
      : 0;
    if (typeof (context.agentLoop as any).checkpointSession === "function") {
      await (context.agentLoop as any).checkpointSession();
    }
    context.writeLine("");
    context.writeLine(`✨ 会话已重置，已开启新话题。${canceled > 0 ? `已同步取消 ${canceled} 个 loop 任务。` : ""}`);
  },
};
