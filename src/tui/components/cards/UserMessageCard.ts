// ============================================================
// UserMessageCard
// ============================================================

import { S, truncate, stripAnsi } from "../../styles/theme.js";

export interface UserMessageOptions {
  content: string;
  timestamp: number;
  availableWidth: number;
}

export function renderUserMessageCard(opt: UserMessageOptions): string[] {
  const { content, timestamp, availableWidth: W } = opt;
  const lines: string[] = [];
  const bodyW = W - 2;

  const timeStr = new Date(timestamp).toLocaleTimeString("zh-CN", { hour12: false });

  // 顶部：标题行
  lines.push(`${S.user("╭─")} ${S.user("👤 你")} ${S.dim("─").repeat(Math.max(0, bodyW - 8))}╮`);

  // 内容（多行）
  const contentLines = content.split("\n").slice(0, 20);
  for (const line of contentLines) {
    const truncated = truncate(line, bodyW - 4);
    lines.push(`${S.user("│")} ${S.primary(truncated)}`);
  }

  // 时间戳（右对齐）
  lines.push(`${S.user("│")} ${S.muted(timeStr)}${" ".repeat(Math.max(0, bodyW - timeStr.length - 3))}${S.user("│")}`);

  // 底部
  lines.push(`${S.user("╰")}${S.user("─").repeat(bodyW)}╯`);

  return lines;
}
