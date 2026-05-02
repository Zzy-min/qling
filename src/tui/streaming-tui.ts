// ============================================================
// streaming-tui.ts - Claude Code 风格流式 Agent CLI
//
// 架构原则：
// 1. Header 只打印一次（启动时）
// 2. 所有输出追加到终端历史，从不重绘
// 3. 底部输入栏：单行 › prompt，光标跟随输入字符
// 4. Agent 执行期间输入栏保持可用
// 5. 执行完毕后调用 showPrompt() 恢复 › prompt
//
// 事件输出（全部 append，不清屏）：
// appendToolStart / appendToolSuccess / appendToolError
// appendThinking / appendCogitated
// appendValidation / appendRepair
// appendFinal / appendError / appendState / appendDone
// ============================================================

import * as readline from "readline";
import { default as stringWidth } from "string-width";

// ── ANSI 颜色工具 ───────────────────────────────────────

function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}`;
}

const C = {
  p: "#36F5B5",   // primary  竹青绿
  s: "#75D7FF",   // secondary 青蓝
  d: "#8B949E",   // dim 灰
  b: "#E6EDF3",   // bright 白
  g: "#4ADE80",   // green
  r: "#FB7185",   // red
  y: "#FACC15",   // yellow
  m: "#E879F9",   // magenta
};

const F = (color: string, s: string): string => `\x1b[38;2;${rgb(color)}m${s}\x1b[0m`;
const S = {
  p: (s: string) => F(C.p, s),
  s: (s: string) => F(C.s, s),
  d: (s: string) => F(C.d, s),
  b: (s: string) => F(C.b, s),
  g: (s: string) => F(C.g, s),
  r: (s: string) => F(C.r, s),
  y: (s: string) => F(C.y, s),
  m: (s: string) => F(C.m, s),
};

const DIM = (s: string): string => `\x1b[2m${s}\x1b[0m`;
const BOLD = (s: string): string => `\x1b[1m${s}\x1b[0m`;

// ── 显示宽度工具 ────────────────────────────────────────

const sw = (s: string): number => stringWidth(s);

function trunc(s: string, maxW: number): string {
  if (sw(s) <= maxW) return s;
  let col = 0;
  let i = 0;
  while (i < s.length && col < maxW - 1) {
    const cw = sw(s[i]);
    if (col + cw > maxW - 1) break;
    col += cw;
    i++;
  }
  return s.slice(0, i) + "…";
}

// ── 表格渲染（box-drawing, string-width 计算列宽） ──────

function printTable(rows: string[][]): void {
  if (rows.length === 0) return;
  const colCount = rows[0].length;
  const colWidths: number[] = new Array(colCount).fill(0);
  for (const row of rows) {
    for (let c = 0; c < colCount; c++) {
      colWidths[c] = Math.max(colWidths[c], sw(row[c] ?? ""));
    }
  }
  const cellWidths = colWidths.map((w) => w + 2);

  process.stdout.write("\n");

  // top border
  let t = "┌";
  for (let c = 0; c < colCount; c++) {
    t += "─".repeat(cellWidths[c]);
    t += c < colCount - 1 ? "┬" : "┐";
  }
  process.stdout.write(t + "\n");

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const isHeader = r === 0;
    let line = "│";
    for (let c = 0; c < colCount; c++) {
      const cell = row[c] ?? "";
      const pad = cellWidths[c] - sw(cell) - 1;
      line += " " + cell + " ".repeat(pad + 1) + "│";
    }
    process.stdout.write((isHeader ? BOLD(line) : line) + "\n");
    if (r === 0) {
      let sep = "├";
      for (let c = 0; c < colCount; c++) {
        sep += "─".repeat(cellWidths[c]);
        sep += c < colCount - 1 ? "┼" : "┤";
      }
      process.stdout.write(sep + "\n");
    }
  }

  // bottom border
  let b = "└";
  for (let c = 0; c < colCount; c++) {
    b += "─".repeat(cellWidths[c]);
    b += c < colCount - 1 ? "┴" : "┘";
  }
  process.stdout.write(b + "\n");
}

// ── Markdown 清理 ───────────────────────────────────────

function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`{1,3}[\s\S]*?`{1,3}/g, (m) => m.replace(/`+/g, ""))
    .replace(/^\s*[-*+]\s+/gm, "$1")
    .replace(/^\s*\d+\.\s+/gm, "$1")
    .replace(/^\s*>\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\n{3,}/g, "\n\n");
}

// ── 行折叠 ─────────────────────────────────────────────

interface CollapsedLines {
  top: string[];
  bottom: string[];
  hidden: number;
}

function collapseLines(lines: string[], maxTop: number, maxBottom: number): CollapsedLines {
  if (lines.length <= maxTop + maxBottom) return { top: lines, bottom: [], hidden: 0 };
  return { top: lines.slice(0, maxTop), bottom: lines.slice(-maxBottom), hidden: lines.length - maxTop - maxBottom };
}

// ── Duration 格式化 ─────────────────────────────────────

function fmtDur(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

// ── StreamUI 主类 ──────────────────────────────────────

export type AgentEvent =
  | { type: "tool_start"; tool: string; command: string }
  | { type: "tool_success"; tool: string; command: string; output: string; durationMs: number }
  | { type: "tool_error"; tool: string; command: string; error: string; durationMs: number }
  | { type: "thinking"; text: string }
  | { type: "cogitated"; durationMs: number }
  | { type: "validation"; status: "pass" | "fail" | "warn"; text: string }
  | { type: "repair"; reason: string; action: string; retryCount: number }
  | { type: "final"; text: string }
  | { type: "error"; text: string }
  | { type: "state"; from: string; to: string }
  | { type: "done"; durationMs: number };

export class StreamUI {
  private model: string;
  private tools: number;
  private input: string = "";
  private cursorPos: number = 0;
  private history: string[] = [];
  private historyIdx: number = -1;
  private running: boolean = false;
  private inputCallback: ((cmd: string) => Promise<void>) | null = null;
  private currentToolRunning: boolean = false;
  private dataHandler: ((chunk: string) => void) | null = null;

  constructor(model: string = "deepseek-chat", tools: number = 0) {
    this.model = model;
    this.tools = tools;
  }

  start(): void {
    this.running = true;
    this.printHeader();
    this.printInputBar();
    this.setupInput();
  }

  stop(): void {
    this.running = false;
    if (this.dataHandler) {
      process.stdin.off("data", this.dataHandler);
      this.dataHandler = null;
    }
    if (typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
    process.stdout.write("\n");
  }

  onInput(cb: (cmd: string) => Promise<void>): void {
    this.inputCallback = cb;
  }

  // ── Header（只调用一次） ───────────────────────────

  private printHeader(): void {
    const pathStr = process.cwd().replace(/\\/g, "/").replace(/^C:/, "C:");
    const line1 = S.p(">_ ") + S.p("轻灵 Agent CLI") + "    " +
      S.s(this.model) + "    " + S.g("online") + "    " +
      S.y("tools") + " " + S.y(String(this.tools));
    const line2 = S.d(pathStr);
    process.stdout.write(line1 + "\n" + line2 + "\n");
  }

  // ── 底部输入栏 ────────────────────────────────────

  private printInputBar(): void {
    const w = process.stdout.columns || 80;
    const sep = "─".repeat(Math.max(1, w));
    process.stdout.write(DIM(sep) + "\n");
    process.stdout.write(S.p("› ") + this.input);
  }

  private backToPrompt(): void {
    process.stdout.write("\r");
    process.stdout.write("\x1b[0K");
  }

  private redrawInput(): void {
    this.backToPrompt();
    process.stdout.write(S.p("› ") + this.input);
    this.syncCursor();
  }

  private syncCursor(): void {
    const col = 2 + this.cursorPos;
    process.stdout.write("\x1b[" + col + "G");
  }

  showPrompt(): void {
    if (!this.running) return;
    process.stdout.write("\n" + DIM("─".repeat(Math.max(1, process.stdout.columns || 80))) + "\n");
    process.stdout.write(S.p("› ") + this.input);
  }

  // ── 键盘输入处理 ─────────────────────────────────

  private setupInput(): void {
    if (typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(true);
    }

    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    let partial = "";

    this.dataHandler = (chunk: string) => {
      if (!this.running) return;
      for (const ch of chunk) {
        const seq = partial + ch;
        if (seq === "\r" || seq === "\n") {
          partial = "";
          this.handleEnter();
        } else if (seq === "\x03") {
          partial = "";
          this.handleCtrlC();
        } else if (seq === "\x7f") {
          partial = "";
          this.handleBackspace();
        } else if (seq === "\x1b[A") {
          partial = "";
          this.handleHistoryUp();
        } else if (seq === "\x1b[B") {
          partial = "";
          this.handleHistoryDown();
        } else if (seq === "\x1b[C") {
          partial = "";
          this.handleRight();
        } else if (seq === "\x1b[D") {
          partial = "";
          this.handleLeft();
        } else if (seq === "\x0f") {
          // Ctrl+O — fold toggle (reserved for future expand/collapse)
          partial = "";
        } else if (seq.startsWith("\x1b[") && seq.length > 4) {
          partial = "";
        } else if (seq.startsWith("\x1b[")) {
          partial = seq;
        } else if (ch >= " " || ch === "\t") {
          partial = "";
          this.handleChar(ch);
        } else {
          partial = "";
        }
      }
    };
    process.stdin.on("data", this.dataHandler);
  }

  private handleEnter(): void {
    const cmd = this.input.trim();
    if (!cmd) return;
    this.history.push(cmd);
    this.historyIdx = this.history.length;
    this.input = "";
    this.cursorPos = 0;
    process.stdout.write("\n");
    if (this.inputCallback) {
      this.inputCallback(cmd);
    }
  }

  private handleCtrlC(): void {
    this.input = "";
    this.cursorPos = 0;
    this.backToPrompt();
    process.stdout.write(S.r("^C") + " " + S.p("› ") + this.input);
  }

  private handleBackspace(): void {
    if (this.cursorPos > 0) {
      this.input = this.input.slice(0, this.cursorPos - 1) + this.input.slice(this.cursorPos);
      this.cursorPos--;
      this.redrawInput();
    }
  }

  private handleHistoryUp(): void {
    if (this.historyIdx > 0) {
      this.historyIdx--;
      this.input = this.history[this.historyIdx] ?? "";
      this.cursorPos = this.input.length;
      this.redrawInput();
    }
  }

  private handleHistoryDown(): void {
    if (this.historyIdx < this.history.length - 1) {
      this.historyIdx++;
      this.input = this.history[this.historyIdx] ?? "";
    } else {
      this.historyIdx = this.history.length;
      this.input = "";
    }
    this.cursorPos = this.input.length;
    this.redrawInput();
  }

  private handleLeft(): void {
    if (this.cursorPos > 0) {
      this.cursorPos--;
      this.syncCursor();
    }
  }

  private handleRight(): void {
    if (this.cursorPos < this.input.length) {
      this.cursorPos++;
      this.syncCursor();
    }
  }

  private handleChar(ch: string): void {
    this.input = this.input.slice(0, this.cursorPos) + ch + this.input.slice(this.cursorPos);
    this.cursorPos++;
    this.redrawInput();
  }

  // ── 工具块渲染 ────────────────────────────────────

  private printToolHeader(tool: string, command: string, status: "running" | "success" | "error"): void {
    const icon = status === "running" ? S.y("●") : status === "success" ? S.g("●") : S.r("●");
    const statusLabel = status === "running" ? DIM("running") : status === "success" ? S.g("pass") : S.r("fail");
    const cmdDisplay = trunc(command, 80);
    process.stdout.write("\n" + icon + " " + S.s(tool) + "(" + S.d(cmdDisplay) + ")" + "\n");
  }

  private printToolOutput(output: string, status: "success" | "error"): void {
    const lines = output.split("\n");
    const isLong = lines.length > 12;
    const collapsed = collapseLines(lines, 8, 2);
    for (const line of collapsed.top) {
      process.stdout.write("  " + DIM(line) + "\n");
    }
    if (collapsed.hidden > 0) {
      const hiddenMsg = "... +" + collapsed.hidden + " lines";
      process.stdout.write("  " + DIM(hiddenMsg) + "\n");
      for (const line of collapsed.bottom) {
        process.stdout.write("  " + DIM(line) + "\n");
      }
    }
    if (isLong) {
      const totalMsg = "... " + lines.length + " lines total  " + S.d("(Ctrl+O to expand)");
      process.stdout.write("  " + DIM(totalMsg) + "\n");
    }
  }

  // ── 事件输出（全部 append，不清屏） ────────────────

  appendToolStart(tool: string, command: string): void {
    this.currentToolRunning = true;
    this.printToolHeader(tool, command, "running");
  }

  appendToolSuccess(tool: string, command: string, output: string, durationMs: number): void {
    if (this.currentToolRunning) {
      process.stdout.write("\x1b[1A\r\x1b[0K");
      this.currentToolRunning = false;
    }
    this.printToolHeader(tool, command, "success");
    const dur = durationMs >= 1000 ? (durationMs / 1000).toFixed(1) + "s" : durationMs + "ms";
    process.stdout.write("  " + S.g("└ " + dur) + "\n");
    if (output.trim()) {
      this.printToolOutput(output, "success");
    }
  }

  appendToolError(tool: string, command: string, error: string, durationMs: number): void {
    if (this.currentToolRunning) {
      process.stdout.write("\x1b[1A\r\x1b[0K");
      this.currentToolRunning = false;
    }
    this.printToolHeader(tool, command, "error");
    const dur = durationMs >= 1000 ? (durationMs / 1000).toFixed(1) + "s" : durationMs + "ms";
    process.stdout.write("  " + S.r("└ Error: ") + S.r(error.split("\n")[0]) + " " + DIM("(" + dur + ")") + "\n");
    const rest = error.split("\n");
    if (rest.length > 1) {
      this.printToolOutput(rest.slice(1).join("\n"), "error");
    }
  }

  appendThinking(text: string): void {
    const lines = text.split("\n").filter((l) => l.trim());
    if (lines.length === 0) return;
    process.stdout.write("\n" + S.s("◆ ") + S.s(lines[0]));
    for (let i = 1; i < lines.length; i++) {
      process.stdout.write("\n  " + DIM(lines[i]));
    }
  }

  appendCogitated(durationMs: number): void {
    process.stdout.write("\n" + DIM("◆ Cogitated for " + fmtDur(durationMs)));
  }

  appendValidation(status: "pass" | "fail" | "warn", text: string): void {
    const icon = status === "pass" ? S.g("●") : status === "fail" ? S.r("●") : S.y("●");
    const label = status === "pass" ? S.g("pass") : status === "fail" ? S.r("fail") : S.y("warn");
    process.stdout.write("\n" + icon + " " + label + "  " + S.d(text));
  }

  appendRepair(reason: string, action: string, retryCount: number): void {
    process.stdout.write("\n" + S.y("[repair]"));
    process.stdout.write("\n  " + S.d("原因:") + " " + S.r(reason));
    process.stdout.write("\n  " + S.d("动作:") + " " + S.b(action));
    process.stdout.write("\n  " + S.d("retry:") + " " + S.y(String(retryCount)));
  }

  appendFinal(text: string): void {
    const cleaned = stripMarkdown(text);
    const lines = cleaned.split("\n");
    const hasTable = lines.some((l) => l.includes("│") || l.includes("|"));
    if (hasTable) {
      const tableRows = this.parseTableLines(lines);
      if (tableRows.length > 1) {
        printTable(tableRows);
        return;
      }
    }
    process.stdout.write("\n" + S.p("● ") + S.p(BOLD("回答")) + "\n");
    for (const line of lines) {
      if (line.trim()) {
        process.stdout.write("  " + line + "\n");
      }
    }
  }

  private parseTableLines(lines: string[]): string[][] {
    const rows: string[][] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "|" || /^[\|\-\s]+$/.test(trimmed)) continue;
      const cells = trimmed.split("|").map((c) => c.trim()).filter((c) => c !== "");
      if (cells.length >= 2) {
        rows.push(cells);
      }
    }
    return rows;
  }

  appendError(text: string): void {
    process.stdout.write("\n" + S.r("● error") + "  " + S.r(text));
  }

  appendState(from: string, to: string): void {
    process.stdout.write("\n" + DIM("[state] ") + S.y(from) + " " + DIM("→") + " " + S.g(to));
  }

  appendDone(durationMs: number): void {
    const dur = fmtDur(durationMs);
    process.stdout.write("\n" + S.g("✓ 完成") + " " + DIM(dur));
  }
}
