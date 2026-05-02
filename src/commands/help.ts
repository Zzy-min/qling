import { SlashCommand } from "./types.js";
import { AgentLoop } from "../agent-loop.js";

export const helpCommand: SlashCommand = {
  name: "/help",
  aliases: ["/?"],
  description: "显示可用指令列表",
  usage: "/help",
  execute: async (args, agentLoop) => {
    console.log("\n【轻灵 Slash Commands】");
    console.log("-----------------------------------------");
    console.log("/help, /?       - 显示此帮助信息");
    console.log("/skill [name]   - 查询或挂载技能");
    console.log("/clear, /reset  - 清空当前对话上下文");
    console.log("/compact        - 手动触发上下文压缩");
    console.log("/config         - 查看当前生效配置");
    console.log("/status         - 查看会话状态与 Token 统计");
    console.log("/dashboard      - 获取观测控制台链接");
    console.log("-----------------------------------------\n");
  },
};
