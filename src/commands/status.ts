import { SlashCommand } from "./types.js";

export const statusCommand: SlashCommand = {
  name: "/status",
  description: "查看会话状态与 Token 统计",
  usage: "/status",
  execute: async (_args, context) => {
    const stats = typeof (context.agentLoop as any).getSessionStats === "function"
      ? await (context.agentLoop as any).getSessionStats()
      : {
          sessionId: typeof (context.agentLoop as any).getSessionId === "function" ? (context.agentLoop as any).getSessionId() : "N/A",
          turnCount: (context.agentLoop as any).turnCount ?? 0,
          tokens: (context.agentLoop as any).sessionTokens ?? 0,
        };
    const taskCount = context.scheduler && typeof (context.scheduler as any).listTasks === "function"
      ? (await (context.scheduler as any).listTasks()).filter((task: any) => task.status !== "canceled").length
      : 0;
    const goalStatus = context.goalController && typeof (context.goalController as any).getGoalStatus === "function"
      ? await (context.goalController as any).getGoalStatus()
      : null;

    context.writeLine("");
    context.writeLine("📊 【会话状态统计】");
    context.writeLine("-----------------------------------------");
    context.writeLine(`会话 ID   : ${stats.sessionId || "N/A"}`);
    context.writeLine(`当前轮次   : ${stats.turnCount}`);
    context.writeLine(`累计 Token : ~${Number(stats.tokens ?? 0).toLocaleString()}`);
    context.writeLine(`活跃工作流 : ${(context.agentLoop as any).getWorkflowRuntime().getCheckpoint()?.runId || "无"}`);
    context.writeLine(`Loop 任务  : ${taskCount}`);
    context.writeLine(`Goal 状态  : ${goalStatus ? goalStatus.status : "无"}`);
    context.writeLine("-----------------------------------------");
    context.writeLine("");
  },
};
