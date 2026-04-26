// ============================================================
// AgentThinkingCard
// ============================================================

import { S, truncate, spin, BDR } from "../../styles/theme.js";

export interface AgentThinkingOptions {
  content: string;
  state: "thinking" | "planning" | "executing" | "answering";
  timestamp: number;
  availableWidth: number;
}

const STATE_LABELS = {
  thinking:  "正在思考",
  planning:  "制定计划",
  executing: "执行中",
  answering: "生成回答",
};

export function renderAgentThinkingCard(opt: AgentThinkingOptions): string[] {
  const { content, state, availableWidth: W } = opt;
  const lines: string[] = [];
  const bodyW = W - 2;

  const sp = spin();
  const label = STATE_LABELS[state] ?? "思考中";
  const borderColor = state === "planning" ? S.plan : state === "executing" ? S.brand : S.agent;

  lines.push(`${borderColor("╭─")} ${sp} ${borderColor(label)} ${S.dim("─").repeat(Math.max(0, bodyW - stripLen(sp + label) - 4))}╮`);

  // 内容在弱背景框内
  lines.push(`${borderColor("│")} ${S.dim("┌")}${BDR.horiz.repeat(Math.max(0, bodyW - 4))}${S.dim("┐")}`);

  const contentLines = content.split("\n").slice(0, 15);
  for (const line of contentLines) {
    const truncated = truncate(line, bodyW - 6);
    lines.push(`${borderColor("│")} ${S.dim("│")} ${S.secondary(truncated)}${" ".repeat(Math.max(0, bodyW - stripLen(truncated) - 7))}${S.dim("│")}`);
  }

  lines.push(`${borderColor("│")} ${S.dim("└")}${BDR.horiz.repeat(Math.max(0, bodyW - 4))}${S.dim("┘")}`);
  lines.push(`${borderColor("╰")}${borderColor("─").repeat(bodyW)}╯`);

  return lines;
}

function stripLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}
