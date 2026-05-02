import { SlashCommand } from "./types.js";
import { AgentLoop } from "../agent-loop.js";

export const clearCommand: SlashCommand = {
  name: "/clear",
  aliases: ["/reset"],
  description: "清空当前对话上下文记忆",
  usage: "/clear",
  execute: async (args, agentLoop) => {
    (agentLoop as any).reset();
    console.log("\n✨ 会话已重置，已开启新话题。");
  },
};
