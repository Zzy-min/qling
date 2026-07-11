import type { SlashCommand } from "./types.js";

const ACTIONS = new Set(["retry", "next", "edit", "cancel"]);

export const recoverCommand: SlashCommand = {
  name: "/recover",
  aliases: ["/恢复策略"],
  description: "查看或控制暂停中的任务恢复策略",
  usage: "/recover status | retry | next | edit | cancel",
  category: "session",
  argumentHint: "status | retry | next | edit | cancel",
  examples: ["/recover status", "/recover next", "/recover edit"],
  execute: async (args, context) => {
    const agent = context.agentLoop as any;
    const action = (args[0] ?? "status").toLowerCase();
    if (typeof agent.getRecoveryState !== "function") {
      context.writeError("恢复控制不可用：当前 AgentLoop 未提供恢复状态。");
      return;
    }
    const state = agent.getRecoveryState();
    if (!state) {
      context.writeLine("当前没有可恢复或暂停的执行任务。");
      return;
    }
    if (action === "status") {
      context.writeLine(formatRecoveryStatus(state));
      return;
    }
    if (!ACTIONS.has(action)) {
      context.writeError("用法: /recover status | retry | next | edit | cancel");
      return;
    }
    const result = agent.applyRecoveryAction(action);
    if (action === "edit" && result.prompt) context.setInputDraft?.(result.prompt);
    if ((action === "retry" || action === "next") && result.state.originalTask) {
      const prefix = action === "next" ? "请采用下一条不同的恢复策略继续原任务：\n" : "请按当前恢复策略重试原任务：\n";
      context.setImmediatePrompt?.(`${prefix}${result.state.originalTask}`);
    }
    context.onRecoveryStateChanged?.(action === "cancel" || action === "edit" ? null : result.state);
    context.writeLine(action === "cancel" ? "任务已取消，失败摘要已保留。" : `恢复动作已应用: ${action}`);
  },
};

function formatRecoveryStatus(state: any): string {
  return [
    "恢复状态",
    `阶段: ${state.status}`,
    `失败类别: ${state.lastFailure?.category ?? "-"}`,
    `失败指纹: ${state.lastFailure?.fingerprint ?? "-"}`,
    `策略尝试: ${state.strategyAttempts}`,
    `剩余预算: ${state.remainingStrategyAttempts}`,
    "动作: /recover retry | next | edit | cancel",
  ].join("\n");
}
