// ============================================================
// FinalAnswerCard
// ============================================================

import { S, truncate } from "../../styles/theme.js";

export interface FinalAnswerCardOptions {
  content: string;
  availableWidth: number;
}

export function renderFinalAnswerCard(opt: FinalAnswerCardOptions): string[] {
  const { content, availableWidth: W } = opt;
  const lines: string[] = [];
  const bodyW = W - 2;

  lines.push(`${S.agent("╭─")} ${S.agent("轻灵回答")} ${S.dim("─".repeat(Math.max(0, bodyW - 10)))}╮`);

  const paragraphs = content.split("\n\n").slice(0, 20);
  for (const para of paragraphs) {
    const paraLines = para.split("\n").slice(0, 30);
    for (const line of paraLines) {
      if (line.trim() === "") {
        lines.push(`${S.agent("│")}`);
        continue;
      }
      // 支持 Markdown 风格加粗（## 标题，粗体）
      const processed = processMarkdownLine(line, bodyW - 4);
      lines.push(`${S.agent("│")}  ${processed}`);
    }
  }

  lines.push(`${S.agent("╰")}${S.agent("─").repeat(bodyW)}╯`);

  return lines;
}

function processMarkdownLine(line: string, maxLen: number): string {
  // 简化：只处理 ## 标题
  if (line.startsWith("## ")) {
    return S.highlight(truncate(line.slice(3), maxLen));
  }
  if (line.startsWith("**") && line.endsWith("**")) {
    return S.primary(truncate(line.slice(2, -2), maxLen));
  }
  return S.primary(truncate(line, maxLen));
}
