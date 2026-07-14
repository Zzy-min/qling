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
    if (action !== "cancel" && state.status !== "paused") {
      context.writeError("当前没有暂停中的恢复任务。请先等待任务进入 paused，或使用 /recover status 查看状态。");
      return;
    }
    let result: { state: any; prompt?: string };
    try {
      result = agent.applyRecoveryAction(action);
    } catch (error) {
      context.writeError(error instanceof Error ? error.message : String(error));
      return;
    }
    if (action === "edit" && result.prompt) context.setInputDraft?.(result.prompt);
    if ((action === "retry" || action === "next") && result.state.originalTask) {
      const strategy = result.state.currentStrategy ?? (action === "next" ? "下一条可用策略" : "当前策略");
      const mode = action === "next" ? "请采用下一条不同的恢复策略" : "请按当前恢复策略";
      context.setImmediatePrompt?.(
        `${mode}（${strategy}）继续原任务；不要重复已失败且没有进展的动作：\n${result.state.originalTask}`
      );
    }
    context.onRecoveryStateChanged?.(action === "cancel" || action === "edit" ? null : result.state);
    context.writeLine(
      action === "cancel"
        ? "任务已取消，失败摘要已保留。"
        : action === "edit"
          ? "已恢复原任务草稿，当前执行卡片已结束。"
          : `恢复动作已应用: ${action}（策略: ${result.state.currentStrategy ?? "-"}）`
    );
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
    `当前策略: ${state.currentStrategy ?? "-"}`,
    `已尝试策略: ${(state.attemptedStrategies ?? []).join(", ") || "-"}`,
    "动作: /recover retry | next | edit | cancel",
  ].join("\n");
}
