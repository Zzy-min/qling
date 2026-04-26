// ============================================================
// screen.ts - 终端屏幕 2D 字符网格渲染引擎
//
// 原则：
// 1. 所有宽度计算使用 string-width（正确处理中日韩文 + emoji）
// 2. 一次性光标定位输出（避免重复渲染）
// 3. 每个区域只写一次，不重复渲染
// 4. 边框只用 ASCII/半角兼容字符，保证宽度可计算
// ============================================================

import { default as stringWidth } from "string-width";

export const W = (s: string): number => stringWidth(s);

export function trimAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

// 把字符串写入 screen[y][x] 坐标（自动处理截断和全角字符）
function writeStr(screen: string[][], y: number, x: number, s: string, maxW: number): void {
  const displayLen = W(s);
  const endX = Math.min(x + displayLen, screen[0].length);
  // For full-width chars that would be truncated mid-char, stop one char early
  const availW = maxW > 0 ? maxW : screen[0].length - x;
  let curX = x;
  let i = 0;
  const raw = s;
  while (i < raw.length && curX < x + availW) {
    const char = raw[i];
    const charW = W(char);
    if (charW === 0) { i++; continue; } // ANSI escape
    if (curX + charW > x + availW) break;
    screen[y][curX] = char;
    curX += charW;
    i++;
  }
}

// 用空格填充从 x 到 x+w 的区域
function fillSpace(screen: string[][], y: number, x: number, w: number): void {
  for (let dx = 0; dx < w; dx++) {
    if (screen[y] && screen[y][x + dx] !== undefined) {
      screen[y][x + dx] = " ";
    }
  }
}

// 创建一个空白的 screen（用空格填充）
function makeScreen(h: number, w: number): string[][] {
  return Array.from({ length: h }, () => Array(w).fill(" "));
}

// 全局 cursor 定位到 (row, col)，0-indexed
function cursorTo(screen: string[][], row: number, col: number): string {
  return `\x1b[${row + 1};${col + 1}H`;
}

// 将 screen 2D 数组渲染为带光标定位指令的完整字符串
function renderScreen(screen: string[][]): string {
  let out = "";
  // 先跳到左上角清除屏幕
  out += "\x1b[2J";  // clear entire screen
  out += "\x1b[H";   // move cursor to home
  out += "\x1b[?25l"; // hide cursor

  for (let y = 0; y < screen.length; y++) {
    let line = "";
    for (let x = 0; x < screen[y].length; x++) {
      line += screen[y][x];
    }
    out += line;
    if (y < screen.length - 1) out += "\n";
  }
  return out;
}

// 在 screen 上画一行（从 y 行, x 列开始，写入字符串，宽度为 w）
function paintLine(screen: string[][], y: number, x: number, s: string, w: number): void {
  // 先填充空格
  fillSpace(screen, y, x, w);
  // 再写字符串
  writeStr(screen, y, x, s, w);
}

// 在 screen 上画多行文本（自动换行处理全角）
function paintMultiLine(screen: string[][], startY: number, x: number, lines: string[], w: number, startRow: number = 0): number {
  // lines: 要绘制的行数组
  // startRow: 从第几行开始绘制（用于跳过前的行）
  let painted = 0;
  for (let i = startRow; i < lines.length; i++) {
    const line = lines[i];
    if (painted + startY >= screen.length) break;
    fillSpace(screen, startY + painted, x, w);
    writeStr(screen, startY + painted, x, line, w);
    painted++;
  }
  return painted;
}

// ============================================================
// 导出渲染器
// ============================================================
export const RenderEngine = {
  makeScreen,
  cursorTo,
  renderScreen,
  paintLine,
  paintMultiLine,
  writeStr,
  fillSpace,
  W,
  trimAnsi,
};
