// ============================================================
// 恢复文案（从 AgentLoop 抽出）— 纯函数，无 IO
// ============================================================

import type { RecoveryState } from "./types.js";

const STRATEGY_INSTRUCTIONS: Record<string, string> = {
  repair_tool_arguments: "检查工具参数 schema，修正参数后只重试这一次工具调用。",
  return_tool_schema: "不要继续执行工具；说明缺失或非法字段，并给出正确参数示例。",
  inspect_command_environment: "先检查 PATH、package scripts 和当前平台可用命令，再选择一个有证据支持的替代命令。",
  use_supported_command: "改用工作区内已有的 package script 或轻灵已注册工具，不要盲目重复原命令。",
  inspect_tool_error: "分析工具错误的直接原因，只修改当前失败目标。",
  retry_tool_once: "在确认参数和目标未变化后，仅重试当前工具一次。",
  narrow_tool_scope: "缩小工具操作范围到当前失败目标，避免重复无关操作。",
  return_tool_diagnostics: "停止重复调用，返回可验证的诊断信息和下一步建议。",
  targeted_verification_repair: "仅修复当前失败测试集合，不重复无关的全量验证。",
  narrow_verification_scope: "缩小验证范围到受影响文件和失败测试，先取得可观测进展。",
  compact_context_once: "仅执行一次上下文压缩，保留用户原文、工具链和错误证据，然后继续任务。",
  transport_retry: "提供方瞬时错误已退避；不要改变任务目标，直接继续。",
};

export function formatRecoveryInstruction(
  failure: { category: string; message: string },
  strategy?: string
): string {
  return (
    `【定向恢复】失败类别=${failure.category}；失败原因=${failure.message}\n` +
    `恢复策略=${strategy ?? "暂无"}\n` +
    (STRATEGY_INSTRUCTIONS[strategy ?? ""] ?? "停止重复动作，基于最新证据选择下一步。")
  );
}

export function formatRecoveryPause(options: {
  reason: string;
  next: string;
  state: RecoveryState | null;
  verificationStagesSummary: string;
}): string {
  const state = options.state;
  const files = state?.lastProgress?.changedFiles?.join(", ") || "-";
  return [
    "执行已暂停",
    `原因: ${options.reason}`,
    `已尝试: ${state?.strategyAttempts ?? 0} 次恢复策略`,
    `当前策略: ${state?.currentStrategy ?? "-"}`,
    `已尝试策略: ${(state?.attemptedStrategies ?? []).join(", ") || "-"}`,
    `当前证据: ${state?.lastFailure?.fingerprint ?? "-"}`,
    `修改文件: ${files}`,
    `验证阶段: ${options.verificationStagesSummary}`,
    `下一步: ${options.next}；使用 /recover retry|next|edit|cancel`,
    "边界: 本地摘要轨迹已保存，不包含 prompt 或工具正文。",
  ].join("\n");
}

export function buildVerificationFailureUserMessage(options: {
  failedStage?: string;
  failedCommand: string;
  failingTests: string[];
  changedFiles: string[];
  fingerprint?: string;
  attemptedStrategies: string[];
  strategy: string;
  stdout: string;
  stderr: string;
  instructionBody: string;
}): string {
  const files = options.changedFiles.join(", ") || "-";
  return (
    `【定向验证失败】阶段=${options.failedStage ?? "unknown"} 命令=\`${options.failedCommand}\`\n` +
    `失败测试=${options.failingTests.join(", ") || "unknown"}\n` +
    `修改文件=${files}\n` +
    `指纹=${options.fingerprint ?? "-"}\n` +
    `已尝试策略=${options.attemptedStrategies.join(", ") || "-"}\n` +
    `恢复策略=${options.strategy}\n[stdout]\n${options.stdout}\n[stderr]\n${options.stderr}\n` +
    options.instructionBody
  );
}
