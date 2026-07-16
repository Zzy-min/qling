import { SlashCommand } from "./types.js";

export const clearCommand: SlashCommand = {
  name: "/clear",
  aliases: ["/reset", "/new"],
  description: "清屏并重置当前会话上下文",
  usage: "/clear",
  execute: async (_args, context) => {
    (context.agentLoop as any).reset();
    if (context.goalController && typeof (context.goalController as any).clearGoal === "function") {
      await (context.goalController as any).clearGoal("conversation_reset");
    }
    const canceled =
      context.scheduler && typeof (context.scheduler as any).cancelAllTasks === "function"
        ? await (context.scheduler as any).cancelAllTasks()
        : 0;
    if (typeof (context.agentLoop as any).checkpointSession === "function") {
      await (context.agentLoop as any).checkpointSession();
    }

    // 清屏 + 重画顶栏/输入框（与 Ctrl+L 同类，并重置会话）
    if (typeof context.repaintChrome === "function") {
      context.repaintChrome();
      return;
    }
    context.writeLine("");
    context.writeLine(
      `✨ 会话已重置。${canceled > 0 ? `已取消 ${canceled} 个 loop 任务。` : ""}`
    );
  },
};
