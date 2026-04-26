// ============================================================
// PlanCard
// ============================================================

import { S, truncate } from "../../styles/theme.js";

export interface PlanItem {
  content: string;
  status: "pending" | "active" | "done";
}

export interface PlanCardOptions {
  plan: PlanItem[];
  timestamp: number;
  availableWidth: number;
}

export function renderPlanCard(opt: PlanCardOptions): string[] {
  const { plan, availableWidth: W } = opt;
  const lines: string[] = [];
  const bodyW = W - 2;

  lines.push(`${S.plan("╭─")} ${S.plan("📋 执行计划")} ${S.dim("─").repeat(Math.max(0, bodyW - 12))}╮`);

  for (let i = 0; i < plan.length; i++) {
    const item = plan[i];
    const num = `${i + 1}`.padStart(2, " ");
    const prefix = item.status === "done" ? S.success("✓") : item.status === "active" ? S.brand("●") : S.muted("◯");
    const text = item.status === "done"
      ? S.dim(item.content)
      : S.primary(item.content);
    const line = `${S.plan("│")}  ${prefix} ${num}. ${text}`;
    lines.push(line + " ".repeat(Math.max(0, bodyW - stripLen(line) - 1)) + S.plan("│"));
  }

  lines.push(`${S.plan("╰")}${S.plan("─").repeat(bodyW)}╯`);

  return lines;
}

function stripLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}
