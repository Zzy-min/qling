// ============================================================
// ToolCallCard - 可折叠工具调用卡片
// ============================================================

import { S, truncate, spin, badge } from "../../styles/theme.js";
import { ToolStatus } from "../../models/types.js";

export interface ToolCallCardOptions {
  name: string;
  arguments: Record<string, unknown>;
  output: string;
  status: ToolStatus;
  durationMs?: number;
  errorType?: string;
  expanded?: boolean;
  timestamp: number;
  availableWidth: number;
}

export function renderToolCallCard(opt: ToolCallCardOptions): string[] {
  const {
    name, arguments: args, output, status,
    durationMs, errorType, expanded = false,
    availableWidth: W,
  } = opt;
  const lines: string[] = [];
  const bodyW = W - 2;

  // 状态图标 + 名称
  const statusIcon = getStatusIcon(status);
  const statusLabel = getStatusLabel(status);
  const borderColor = getBorderColor(status);

  const duration = durationMs != null ? ` ${S.dim(durationMs + "ms")}` : "";
  const argsSummary = truncate(JSON.stringify(args), bodyW - stripLen(statusIcon + name + statusLabel) - 12);

  lines.push(`${borderColor("╭─")} ${statusIcon} ${borderColor(name)} ${borderColor(statusLabel)}${duration} ${S.dim("─").repeat(Math.max(0, bodyW - stripLen(statusIcon + name + statusLabel + duration) - 6))}╮`);
  lines.push(`${borderColor("│")}  ${S.dim("参数:")} ${S.secondary(argsSummary)}`);

  // 输出部分
  if (!expanded) {
    const firstLine = output.split("\n")[0];
    const preview = truncate(firstLine, bodyW - 10);
    const outputColor = status === "fail" ? S.error : status === "pass" ? S.success : S.secondary;
    lines.push(`${borderColor("│")}  ${S.dim("输出:")} ${outputColor(preview)}`);

    const totalLines = output.split("\n").length;
    const moreChars = output.length;
    if (totalLines > 1 || moreChars > bodyW - 10) {
      lines.push(`${borderColor("│")}  ${S.muted(`▶ 展开 (${totalLines}行, ${moreChars}字符)`)}`);
    }
  } else {
    // 展开状态
    lines.push(`${borderColor("│")}  ${S.dim("▼ 输出:")}`);
    lines.push(`${borderColor("│")}  ${S.dim("─".repeat(Math.max(0, bodyW - 4)))}`);
    for (const ol of output.split("\n").slice(0, 30)) {
      const truncated = truncate(ol, bodyW - 6);
      lines.push(`${borderColor("│")}  ${S.secondary(truncated)}`);
    }
    const totalLines = output.split("\n").length;
    if (totalLines > 30) {
      lines.push(`${borderColor("│")}  ${S.muted(`... 还有 ${totalLines - 30} 行`)}`);
    }
    lines.push(`${borderColor("│")}  ${S.dim("─".repeat(Math.max(0, bodyW - 4)))}`);
    lines.push(`${borderColor("│")}  ${S.muted("▶ 折叠")}`);
  }

  // 错误信息
  if (errorType) {
    lines.push(`${borderColor("│")}  ${S.error("✕ 错误:")} ${S.error(errorType)}`);
    lines.push(`${borderColor("│")}  ${S.muted("[↻ 重试]")}`);
  }

  lines.push(`${borderColor("╰")}${borderColor("─").repeat(bodyW)}╯`);

  return lines;
}

function getStatusIcon(s: ToolStatus): string {
  switch (s) {
    case "waiting":  return S.muted("○");
    case "running":  return spin();
    case "pass":     return S.success("✓");
    case "fail":     return S.error("✕");
    case "repairing":return S.repair("↻");
    case "skipped":  return S.muted("–");
    default:         return S.secondary("?");
  }
}

function getStatusLabel(s: ToolStatus): string {
  switch (s) {
    case "waiting":  return "等待";
    case "running":  return "运行中";
    case "pass":     return "通过";
    case "fail":     return "失败";
    case "repairing":return "修复中";
    case "skipped":  return "跳过";
    default:         return s;
  }
}

function getBorderColor(s: ToolStatus): (t: string) => string {
  switch (s) {
    case "waiting":  return S.secondary;
    case "running":  return S.brand;
    case "pass":     return S.success;
    case "fail":     return S.error;
    case "repairing":return S.repair;
    case "skipped":  return S.muted;
    default:         return S.secondary;
  }
}

function stripLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}
