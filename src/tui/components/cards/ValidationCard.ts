// ============================================================
// ValidationCard
// ============================================================

import { S, verdictBadge, truncate } from "../../styles/theme.js";

export interface ValidationCardOptions {
  verdict: "PASS" | "FAIL" | "PARTIAL" | "WARN";
  details: string;
  steps?: Array<{ description: string; passed: boolean }>;
  availableWidth: number;
}

export function renderValidationCard(opt: ValidationCardOptions): string[] {
  const { verdict, details, steps, availableWidth: W } = opt;
  const lines: string[] = [];
  const bodyW = W - 2;

  const badge_ = verdictBadge(verdict);
  const borderColor = verdict === "PASS" ? S.success
    : verdict === "FAIL" ? S.error
    : S.warning;

  lines.push(`${borderColor("╭─")} ${badge_} ${S.dim("─".repeat(Math.max(0, bodyW - stripLen(badge_) - 4)))}╮`);

  if (details) {
    lines.push(`${borderColor("│")}  ${S.secondary(truncate(details, bodyW - 4))}`);
  }

  if (steps && steps.length > 0) {
    lines.push(`${borderColor("│")}  ${S.dim("检查项:")}`);
    for (const step of steps) {
      const icon = step.passed ? S.success("✓") : S.error("✕");
      const text = step.passed ? S.dim(step.description) : S.primary(step.description);
      lines.push(`${borderColor("│")}  ${icon} ${text}`);
    }
  }

  if (verdict === "FAIL" || verdict === "PARTIAL") {
    lines.push(`${borderColor("│")}  ${S.muted("[↻ 重试]")}`);
  }

  lines.push(`${borderColor("╰")}${borderColor("─").repeat(bodyW)}╯`);

  return lines;
}

function stripLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}
