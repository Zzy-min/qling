// ============================================================
// RepairCard
// ============================================================

import { S, spin, truncate } from "../../styles/theme.js";

export interface RepairCardOptions {
  attempts: Array<{ description: string; status: "pending" | "running" | "success" | "fail" }>;
  finalStatus?: "success" | "fail";
  availableWidth: number;
}

export function renderRepairCard(opt: RepairCardOptions): string[] {
  const { attempts, finalStatus, availableWidth: W } = opt;
  const lines: string[] = [];
  const bodyW = W - 2;

  lines.push(`${S.repair("╭─")} ${S.repair("↻ 自动修复")} ${S.dim("─".repeat(Math.max(0, bodyW - 12)))}╮`);

  for (const attempt of attempts) {
    const icon = attempt.status === "success"  ? S.success("✓")
               : attempt.status === "running"  ? spin()
               : attempt.status === "fail"     ? S.error("✕")
               : S.muted("○");
    const text = attempt.status === "pending" ? S.muted(attempt.description)
               : attempt.status === "running" ? S.repair(attempt.description)
               : attempt.status === "success" ? S.dim(attempt.description)
               : S.error(attempt.description);
    lines.push(`${S.repair("│")}  ${icon} ${text}`);
  }

  if (finalStatus === "success") {
    lines.push(`${S.repair("│")}  ${S.success("✓ 修复成功")}`);
  } else if (finalStatus === "fail") {
    lines.push(`${S.repair("│")}  ${S.error("✕ 修复失败，请手动干预")}`);
  }

  lines.push(`${S.repair("╰")}${S.repair("─").repeat(bodyW)}╯`);

  return lines;
}
