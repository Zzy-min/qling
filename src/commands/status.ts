import { SlashCommand } from "./types.js";
import { AgentLoop } from "../agent-loop.js";

export const statusCommand: SlashCommand = {
  name: "/status",
  description: "查看会话状态与 Token 统计",
  usage: "/status",
  execute: async (args, agentLoop) => {
    const stats = (agentLoop as any).getSessionId ? {
      sessionId: (agentLoop as any).sessionId,
      turnCount: (agentLoop as any).turnCount,
      tokens: (agentLoop as any).sessionTokens,
    } : {
      turnCount: (agentLoop as any).turnCount,
      tokens: (agentLoop as any).sessionTokens,
    };

    console.log("\n📊 【会话状态统计】");
    console.log("-----------------------------------------");
    console.log(`会话 ID   : ${stats.sessionId || "N/A"}`);
    console.log(`当前轮次   : ${stats.turnCount}`);
    console.log(`累计 Token : ~${stats.tokens.toLocaleString()}`);
    console.log(`活跃工作流 : ${(agentLoop as any).getWorkflowRuntime().getCheckpoint()?.runId || "无"}`);
    console.log("-----------------------------------------\n");
  },
};
