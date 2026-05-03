import { SlashCommand } from "./types.js";
import { AgentLoop } from "../agent-loop.js";
import axios from "axios";

export const detachCommand: SlashCommand = {
  name: "/detach",
  description: "将当前任务脱离终端在后台运行 (v0.5 M3)",
  usage: "/detach",
  execute: async (args, agentLoop) => {
    const DAEMON_PORT = process.env.QINGLING_DAEMON_PORT || "9998";
    const endpoint = `http://localhost:${DAEMON_PORT}/missions`;

    console.log("\n🚀 【正在尝试后台脱离...】");
    
    try {
      // 1. 尝试向守护进程提交当前任务
      await axios.post(endpoint, {
        name: "Detached Mission",
        description: "从交互式会话脱离的任务",
        sessionId: agentLoop.getSessionId(),
      }, { timeout: 3000 });

      console.log("-----------------------------------------");
      console.log("✅ 使命已成功移交至 qinglingd 守护进程。");
      console.log("状态 : 已脱离 (Detached)");
      console.log("提示 : 您现在可以安全地关闭此终端。");
      console.log(`查看 : 请访问 Dashboard 或输入 qingling mission list`);
      console.log("-----------------------------------------\n");
      
      // 触发本进程退出逻辑
      process.exit(0);

    } catch (err: any) {
      console.error("-----------------------------------------");
      console.error("❌ 脱离失败: 守护进程 qinglingd 未响应。");
      console.error("请确保已运行 `qinglingd` (node dist/daemon.js)。");
      console.error("-----------------------------------------\n");
    }
  },
};
