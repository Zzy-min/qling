// ============================================================
// WelcomeCard - 欢迎空态
// ============================================================

import { S, padRight, truncate } from "../../styles/theme.js";

export interface WelcomeCardOptions {
  availableWidth: number;
}

export function renderWelcomeCard(opt: WelcomeCardOptions): string[] {
  const { availableWidth: W } = opt;
  const lines: string[] = [];

  // 卡片顶部
  lines.push(`${S.dim("╭")} ${S.brand("🌬 欢迎使用轻灵 Agent CLI")} ${S.dim("─").repeat(Math.max(0, W - 32))}╮`);
  lines.push(`${S.dim("│")}                                                          ${S.dim("│")}`);

  // 说明
  const desc = "输入自然语言任务，轻灵会自动规划、调用工具、验证结果并修复错误。";
  lines.push(`${S.dim("│")}  ${S.secondary(desc)}`);
  lines.push(`${S.dim("│")}                                                          ${S.dim("│")}`);

  // 特点列表
  const features = [
    ["✦", "理解意图并制定计划"],
    ["✦", "调用合适工具执行"],
    ["✦", "验证结果并修复错误"],
    ["✦", "生成完整回答"],
  ];
  for (const [icon, text] of features) {
    lines.push(`${S.dim("│")}  ${S.brand(icon)} ${S.primary(text)}`);
  }

  lines.push(`${S.dim("│")}                                                          ${S.dim("│")}`);
  lines.push(`${S.dim("├")} ${S.secondary("快捷示例")} ${S.dim("─").repeat(Math.max(0, W - 22))}┤`);
  lines.push(`${S.dim("│")}                                                          ${S.dim("│")}`);

  // 示例
  const examples = [
    ["🌤", "查询郑州今天天气"],
    ["📁", "总结当前目录结构"],
    ["🔧", "修复上一次命令错误"],
    ["📝", "生成 README 文档"],
  ];
  for (const [icon, text] of examples) {
    const exampleText = `${S.dim("│")}  ${icon} ${S.primary(text)}`;
    lines.push(exampleText + " ".repeat(Math.max(0, W - stripLen(exampleText) - 1)) + S.dim("│"));
  }

  lines.push(`${S.dim("│")}                                                          ${S.dim("│")}`);
  lines.push(`${S.dim("╰")}${S.dim("─").repeat(W)}╯`);

  return lines;
}

function stripLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}
