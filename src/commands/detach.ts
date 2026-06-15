import { SlashCommand } from "./types.js";
import axios from "axios";

export const detachCommand: SlashCommand = {
  name: "/detach",
  description: "将当前任务脱离终端在后台运行 (v0.5 M3)",
  usage: "/detach",
  execute: async (_args, context) => {
    const DAEMON_PORT = process.env.QLING_DAEMON_PORT || "9998";
    const endpoint = `http://localhost:${DAEMON_PORT}/missions`;

    context.writeLine("");
    context.writeLine("🚀 【正在尝试后台脱离...】");

    try {
      // 1. 获取当前状态快照
      const checkpoint = (context.agentLoop as any).getWorkflowRuntime().getCheckpoint();
      const stats = {
        turnCount: (context.agentLoop as any).turnCount,
        sessionTokens: (context.agentLoop as any).sessionTokens,
      };

      // 2. 提交至守护进程
      await axios.post(endpoint, {
        name: "Detached Mission",
        description: "从交互式会话脱离的任务",
        sessionId: (context.agentLoop as any).getSessionId(),
        checkpoint,
        stats,
      }, { timeout: 3000 });

      context.writeLine("-----------------------------------------");
      context.writeLine("✅ 使命已成功移交至 qlingd 守护进程。");
      context.writeLine("状态 : 已脱离 (Detached)");
      context.writeLine("提示 : 您现在可以安全地关闭此终端。");
      context.writeLine("查看 : 请访问 Dashboard 或输入 qling mission list");
      context.writeLine("-----------------------------------------");
      context.writeLine("");

      // 触发本进程退出逻辑
      process.exit(0);

    } catch (err: any) {
      context.writeError("-----------------------------------------");
      context.writeError("❌ 脱离失败: 守护进程 qlingd 未响应。");
      context.writeError("请先执行 `qling daemon start` 启动后台守护进程。");
      context.writeError("-----------------------------------------");
      context.writeError("");
    }
  },
};
