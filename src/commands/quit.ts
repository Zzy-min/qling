import { SlashCommand } from "./types.js";

export const quitCommand: SlashCommand = {
  name: "/quit",
  aliases: ["/exit", "/q", "/退出"],
  description: "退出 qling 交互会话",
  usage: "/quit",
  category: "local",
  examples: ["/quit", "/exit"],
  execute: async (_args, context) => {
    // TUI 宿主注入优雅退出：停止 UI、scheduler，并等待 agent.shutdown()
    if (context.requestExit) {
      await context.requestExit();
      return;
    }
    // 兼容未注入退出回调的宿主（与 /detach 的进程退出路径一致）
    process.exit(0);
  },
};