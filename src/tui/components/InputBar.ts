// ============================================================
// InputBar - 底部固定输入栏
// ============================================================

import { S, stripAnsi } from "../styles/theme.js";

function ansiLen(s: string): number {
  return stripAnsi(s).length;
}

export interface InputBarOptions {
  value: string;
  cursorPos: number;
  prompt: string;
  placeholder: string;
  shortcuts: string;
  terminalWidth: number;
}

export function renderInputBar(opt: InputBarOptions): string[] {
  const {
    value, cursorPos, prompt,
    placeholder, shortcuts,
    terminalWidth: W,
  } = opt;

  const lines: string[] = [];

  // ── 第 1 行：prompt + 输入内容 + 光标 ──
  let displayValue = value;
  if (displayValue === "") {
    displayValue = S.muted(placeholder);
  }

  const promptStr = `${S.brand(prompt)} `;
  const beforeCursor = displayValue.slice(0, cursorPos);
  const charAfterCursor = displayValue[cursorPos] ?? "";
  const afterCursor = displayValue.slice(cursorPos + 1);

  // 计算可用宽度
  const promptLen = ansiLen(promptStr);
  const maxInputW = W - 2; // 左右各留 1 padding
  const maxInputLen = maxInputW - promptLen;

  // 截断（光标附近优先展示）
  let shownBefore = beforeCursor;
  let shownAfter = afterCursor;
  if (ansiLen(beforeCursor + afterCursor) > maxInputLen) {
    const vis = maxInputLen - 1;
    shownBefore = beforeCursor.slice(-Math.floor(vis / 2));
    shownAfter = afterCursor.slice(0, Math.ceil(vis / 2));
  }

  const cursorChar = S.highlight(S.bgPanel(charAfterCursor || " "));
  const inputLine = promptStr + shownBefore + cursorChar + shownAfter;

  // 填充到终端宽度
  const inputLen = ansiLen(inputLine);
  lines.push(inputLine + " ".repeat(Math.max(0, W - inputLen)));

  // ── 第 2 行：快捷键提示 ──
  const shortcutsStr = S.muted(shortcuts);
  lines.push(shortcutsStr + " ".repeat(Math.max(0, W - ansiLen(shortcutsStr))));

  return lines;
}
