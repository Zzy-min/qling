// ============================================================
// streaming-tui.ts - Claude Code 风格流式 Agent CLI
//
// 架构原则：
// 1. Header 只打印一次（启动时）
// 2. 所有输出追加到终端历史，从不重绘
// 3. 底部输入栏：› prompt，支持 Ctrl+N 插入多行、Ctrl+R 搜索历史
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
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { default as stringWidth } from "string-width";
import { findSlashCompletion, formatSlashCommandPanel } from "../commands/index.js";
import { InputBuffer } from "./input-buffer.js";
import { formatProgressPulse } from "./progress.js";
import {
  formatBottomHints,
  formatWelcomeGuide,
  formatResultBox,
  formatRoleHeader,
  formatToolTimelineRow,
  formatTopBar,
  padVisible,
  truncateVisible,
} from "./shell.js";

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

function resolvePackageVersion(): string {
  try {
    const packagePath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
    const parsed = JSON.parse(readFileSync(packagePath, "utf8"));
    return typeof parsed.version === "string" && parsed.version.trim() ? parsed.version.trim() : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

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
  private chromeStatus: { tokens?: number; branch?: string | null; workspace?: string; ready?: boolean } = {};
  private input = new InputBuffer();
  private running: boolean = false;
  private inputCallback: ((cmd: string) => Promise<void>) | null = null;
  private currentToolRunning: boolean = false;
  private dataHandler: ((chunk: string) => void) | null = null;
  private statusLine: string | null = null;
  private statusLineEnabled = true;
  private progressTimer: NodeJS.Timeout | null = null;
  private progressStartedAt = 0;
  private progressLabel = "agent";
  private lastEmptyCtrlCAt = 0;
  private lastClearedDraft: string | null = null;
  private expandLongToolOutput = false;
  private lastInputContentLineCount = 1;
  private lastInputCursorLineIndex = 0;
  private lastInputHintLineCount = 0;
  private slashCompletionSelectedIndex = 0;
  private inputCursorAnchor: "current" | "bottom" = "current";
  private readonly now: () => number;
  private readonly doubleCtrlCExitWindowMs = 2_000;

  constructor(
    model: string = "deepseek-chat",
    tools: number = 0,
    options: { now?: () => number } = {}
  ) {
    this.model = model;
    this.tools = tools;
    this.now = options.now ?? (() => Date.now());
  }

  start(): void {
    this.running = true;
    this.printHeader();
    this.printInputBar();
    this.setupInput();
  }

  stop(): void {
    this.running = false;
    this.stopProgress();
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

  setStatusLine(line: string | null): void {
    this.statusLine = line;
  }

  setStatusLineEnabled(enabled: boolean): void {
    this.statusLineEnabled = enabled;
  }

  setChromeStatus(status: { tokens?: number; branch?: string | null; workspace?: string; ready?: boolean }): void {
    this.chromeStatus = { ...this.chromeStatus, ...status };
  }

  setModel(model: string): void {
    const next = String(model ?? "").trim();
    if (next) this.model = next;
  }

  setHistory(entries: string[]): void {
    this.input.setHistory(entries);
  }

  startProgress(label: string = "agent", intervalMs: number = 10_000): void {
    this.stopProgress();
    this.progressLabel = label.trim() || "agent";
    this.progressStartedAt = Date.now();
    const safeIntervalMs = Math.max(1_000, intervalMs);
    this.progressTimer = setInterval(() => {
      const elapsedMs = Date.now() - this.progressStartedAt;
      process.stdout.write("\n" + DIM(formatProgressPulse(this.progressLabel, elapsedMs)));
    }, safeIntervalMs);
    this.progressTimer.unref?.();
  }

  stopProgress(): void {
    if (!this.progressTimer) return;
    clearInterval(this.progressTimer);
    this.progressTimer = null;
  }

  // ── Header（只调用一次） ───────────────────────────

  private printHeader(): void {
    const width = process.stdout.columns || 120;
    const lines = formatTopBar({
      productName: "轻灵",
      englishName: "Qling",
      version: resolvePackageVersion(),
      model: this.model,
      workspace: this.chromeStatus.workspace ?? process.cwd(),
      tokens: this.chromeStatus.tokens ?? 0,
      branch: this.chromeStatus.branch ?? "-",
      ready: this.chromeStatus.ready ?? true,
      width,
    });
    process.stdout.write(S.p(lines[0]) + "\n");
    process.stdout.write(S.d(lines[1]) + "\n");
    for (const line of formatWelcomeGuide(width)) {
      process.stdout.write(DIM(line) + "\n");
    }
  }

  // ── 底部输入栏 ────────────────────────────────────

  private printInputBar(): void {
    const w = process.stdout.columns || 80;
    if (this.statusLineEnabled && this.statusLine) {
      process.stdout.write(DIM(trunc(this.statusLine, Math.max(20, w))) + "\n");
    }
    process.stdout.write(DIM(formatBottomHints()) + "\n");
    process.stdout.write(S.p(this.inputFrameTop()) + "\n");
    this.writeInputValue(true);
    this.syncCursor();
  }

  private backToPrompt(): void {
    this.moveToInputContentStart();
    process.stdout.write("\r");
    process.stdout.write("\x1b[J");
  }

  private redrawInput(): void {
    this.backToPrompt();
    this.writeInputValue();
    this.syncCursor();
  }

  private syncCursor(): void {
    const cursor = this.inputCursorPosition();
    if (this.inputCursorAnchor === "bottom") {
      const rowsUp = Math.max(0, this.lastInputContentLineCount + this.lastInputHintLineCount - cursor.lineIndex);
      if (rowsUp > 0) {
        process.stdout.write("\x1b[" + rowsUp + "A");
      }
    } else {
      const rowDelta = cursor.lineIndex - this.lastInputCursorLineIndex;
      if (rowDelta > 0) {
        process.stdout.write("\x1b[" + rowDelta + "B");
      } else if (rowDelta < 0) {
        process.stdout.write("\x1b[" + Math.abs(rowDelta) + "A");
      }
    }
    const col = 5 + sw(cursor.columnText);
    process.stdout.write("\x1b[" + col + "G");
    this.lastInputCursorLineIndex = cursor.lineIndex;
    this.inputCursorAnchor = "current";
  }

  private inputFrameWidth(): number {
    return Math.max(40, process.stdout.columns || 80);
  }

  private inputFrameContentWidth(): number {
    return Math.max(20, this.inputFrameWidth() - 4);
  }

  private inputFrameTop(): string {
    return "┌" + "─".repeat(this.inputFrameContentWidth() + 2) + "┐";
  }

  private inputFrameBottom(): string {
    return "└" + "─".repeat(this.inputFrameContentWidth() + 2) + "┘";
  }

  private inputDisplayLines(usePlaceholder = false): string[] {
    if (this.input.value) return this.input.value.split("\n");
    return [usePlaceholder ? "输入任务，或按 / 打开命令面板" : ""];
  }

  private inputCursorPosition(): { lineIndex: number; columnText: string } {
    const beforeCursor = this.input.value.slice(0, this.input.cursorPos);
    const beforeLines = beforeCursor.split("\n");
    const lineIndex = Math.max(0, beforeLines.length - 1);
    return {
      lineIndex,
      columnText: beforeLines.at(-1) ?? "",
    };
  }

  private moveToInputContentStart(): void {
    const rowsUp = this.inputCursorAnchor === "bottom"
      ? this.lastInputContentLineCount + this.lastInputHintLineCount
      : this.lastInputCursorLineIndex;
    if (rowsUp > 0) {
      process.stdout.write("\x1b[" + rowsUp + "A");
    }
    this.lastInputCursorLineIndex = 0;
    this.inputCursorAnchor = "current";
  }

  private moveAfterInputFrame(): void {
    if (this.inputCursorAnchor === "current") {
      const rowsDown = Math.max(0, this.lastInputContentLineCount + this.lastInputHintLineCount - this.lastInputCursorLineIndex);
      if (rowsDown > 0) {
        process.stdout.write("\x1b[" + rowsDown + "B");
      }
    }
    process.stdout.write("\r");
    this.lastInputCursorLineIndex = 0;
    this.inputCursorAnchor = "current";
  }

  private writeInputValue(usePlaceholder = false): void {
    const contentWidth = this.inputFrameContentWidth();
    const lines = this.inputDisplayLines(usePlaceholder);

    for (let i = 0; i < lines.length; i++) {
      const prefix = i === 0 ? "› " : "  ";
      const rendered = truncateVisible(prefix + (lines[i] ?? ""), contentWidth);
      if (i > 0) process.stdout.write("\n");
      process.stdout.write(S.p("│ " + padVisible(rendered, contentWidth) + " │"));
    }
    process.stdout.write("\n" + S.p(this.inputFrameBottom()));
    const hints = this.formatCurrentSlashCompletionHints();
    for (const hint of hints) {
      process.stdout.write("\n" + DIM(hint));
    }
    this.lastInputContentLineCount = lines.length;
    this.lastInputHintLineCount = hints.length;
    this.inputCursorAnchor = "bottom";
  }

  private formatCurrentSlashCompletionHints(): string[] {
    if (!this.isSlashCompletionActive(this.input.value)) return [];
    const matches = findSlashCompletion(this.input.value, 8);
    if (matches.length > 0 && this.slashCompletionSelectedIndex >= matches.length) {
      this.slashCompletionSelectedIndex = 0;
    }
    return formatSlashCommandPanel(this.input.value, this.slashCompletionSelectedIndex, process.stdout.columns || 80, 8);
  }

  private isSlashCompletionPrefix(value: string): boolean {
    const text = value.trim();
    return text.startsWith("/") && !/\s/.test(text);
  }

  private isSlashCompletionActive(value: string): boolean {
    return value.startsWith("/") && (!/\s/.test(value.trim()) || /\s$/.test(value));
  }

  private acceptSlashCompletion(): boolean {
    if (!this.isSlashCompletionPrefix(this.input.value)) return false;
    const matches = findSlashCompletion(this.input.value, 8);
    const completion = matches[this.slashCompletionSelectedIndex] ?? matches[0];
    if (!completion) return false;
    this.input.value = completion.name + " ";
    this.input.cursorPos = this.input.value.length;
    this.slashCompletionSelectedIndex = 0;
    this.lastEmptyCtrlCAt = 0;
    this.redrawInput();
    return true;
  }

  private moveSlashCompletionSelection(delta: number): boolean {
    if (!this.isSlashCompletionPrefix(this.input.value)) return false;
    const matches = findSlashCompletion(this.input.value, 8);
    if (matches.length <= 1) return false;
    this.slashCompletionSelectedIndex =
      (this.slashCompletionSelectedIndex + delta + matches.length) % matches.length;
    this.redrawInput();
    return true;
  }

  showPrompt(): void {
    if (!this.running) return;
    const w = process.stdout.columns || 80;
    process.stdout.write("\n");
    if (this.statusLineEnabled && this.statusLine) {
      process.stdout.write(DIM(trunc(this.statusLine, Math.max(20, w))) + "\n");
    }
    process.stdout.write(DIM(formatBottomHints()) + "\n");
    process.stdout.write(S.p(this.inputFrameTop()) + "\n");
    this.writeInputValue(true);
    this.syncCursor();
  }

  // ── 键盘输入处理 ─────────────────────────────────

  private setupInput(): void {
    if (typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(true);
    }

    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    let partial = "";
    let bracketedPaste = false;
    let pasteSawCarriageReturn = false;

    this.dataHandler = (chunk: string) => {
      if (!this.running) return;
      if (chunk === "\x1b") {
        partial = "";
        return;
      }

      for (const ch of chunk) {
        if (!partial && ch === "\x1b") {
          partial = ch;
          continue;
        }

        const seq = partial + ch;
        if (seq === "\x1b[200~") {
          partial = "";
          bracketedPaste = true;
          pasteSawCarriageReturn = false;
        } else if (seq === "\x1b[201~") {
          partial = "";
          bracketedPaste = false;
          pasteSawCarriageReturn = false;
          this.redrawInput();
        } else if (seq === "\x1b[" || /^\x1b\[\d*(?:;\d*)?$/.test(seq)) {
          partial = seq;
        } else if (bracketedPaste) {
          partial = "";
          if (seq === "\r") {
            this.input.insertNewline();
            pasteSawCarriageReturn = true;
          } else if (seq === "\n") {
            if (!pasteSawCarriageReturn) {
              this.input.insertNewline();
            }
            pasteSawCarriageReturn = false;
          } else if (ch >= " " || ch === "\t") {
            pasteSawCarriageReturn = false;
            this.input.insertChar(ch);
          }
        } else if (seq === "\r" || seq === "\n") {
          partial = "";
          this.handleEnter();
        } else if (seq === "\t") {
          partial = "";
          this.handleTab();
        } else if (seq === "\x03") {
          partial = "";
          this.handleCtrlC();
        } else if (seq === "\x7f") {
          partial = "";
          this.handleBackspace();
        } else if (seq === "\x01") {
          partial = "";
          this.handleCtrlA();
        } else if (seq === "\x05") {
          partial = "";
          this.handleCtrlE();
        } else if (seq === "\x15") {
          partial = "";
          this.handleCtrlU();
        } else if (seq === "\x0b") {
          partial = "";
          this.handleCtrlK();
        } else if (seq === "\x17") {
          partial = "";
          this.handleCtrlW();
        } else if (seq === "\x1a") {
          partial = "";
          this.handleCtrlZ();
        } else if (seq === "\x0c") {
          partial = "";
          this.handleCtrlL();
        } else if (seq === "\x04") {
          partial = "";
          this.handleCtrlD();
        } else if (seq === "\x1b[A") {
          partial = "";
          this.handleHistoryUp();
        } else if (seq === "\x1b[B") {
          partial = "";
          this.handleHistoryDown();
        } else if (seq === "\x1b[1;3A" || seq === "\x1b[1;5A" || seq === "\x1b[5A") {
          partial = "";
          this.handleLineUp();
        } else if (seq === "\x1b[1;3B" || seq === "\x1b[1;5B" || seq === "\x1b[5B") {
          partial = "";
          this.handleLineDown();
        } else if (seq === "\x1b[3~") {
          partial = "";
          this.handleDelete();
        } else if (seq === "\x1bd" || seq === "\x1b[3;5~" || seq === "\x1b[3;3~") {
          partial = "";
          this.handleAltD();
        } else if (seq === "\x1bb" || seq === "\x1b[1;3D" || seq === "\x1b[1;5D" || seq === "\x1b[5D") {
          partial = "";
          this.handleWordLeft();
        } else if (seq === "\x1bf" || seq === "\x1b[1;3C" || seq === "\x1b[1;5C" || seq === "\x1b[5C") {
          partial = "";
          this.handleWordRight();
        } else if (seq === "\x1b[C") {
          partial = "";
          this.handleRight();
        } else if (seq === "\x1b[D") {
          partial = "";
          this.handleLeft();
        } else if (seq === "\x1b[H" || seq === "\x1b[1~") {
          partial = "";
          this.handleHome();
        } else if (seq === "\x1b[F" || seq === "\x1b[4~") {
          partial = "";
          this.handleEnd();
        } else if (seq === "\x0f") {
          partial = "";
          this.handleCtrlO();
        } else if (seq === "\x0e") {
          // Ctrl+N inserts a newline while Enter still submits.
          partial = "";
          this.handleNewline();
        } else if (seq === "\x12") {
          // Ctrl+R restores the latest history entry matching the current input.
          partial = "";
          this.handleHistorySearch();
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
    const cmd = this.input.value.trim();
    if (!cmd) return;
    this.lastEmptyCtrlCAt = 0;
    this.moveAfterInputFrame();
    process.stdout.write("\n");
    this.input.submit();
    if (this.inputCallback) {
      this.inputCallback(cmd);
    }
  }

  private handleTab(): void {
    if (!this.input.value) {
      this.lastEmptyCtrlCAt = 0;
      process.stdout.write("\n");
      if (this.inputCallback) {
        this.inputCallback("/agents");
      }
      return;
    }

    if (this.acceptSlashCompletion()) {
      return;
    }

    this.backToPrompt();
    process.stdout.write(S.y("Tab agents 仅在空输入时打开；当前草稿已保留，补全未启用"));
    process.stdout.write("\n");
    this.writeInputValue();
    this.syncCursor();
  }

  private handleCtrlC(): void {
    if (!this.input.value) {
      const now = this.now();
      const shouldExit =
        this.lastEmptyCtrlCAt > 0 &&
        now - this.lastEmptyCtrlCAt <= this.doubleCtrlCExitWindowMs;
      this.lastEmptyCtrlCAt = shouldExit ? 0 : now;

      if (shouldExit) {
        process.stdout.write("\n" + DIM("再次 Ctrl+C 已确认退出") + "\n");
        if (this.inputCallback) {
          this.inputCallback("exit");
        }
        return;
      }

      this.backToPrompt();
      process.stdout.write(S.r("^C") + " " + DIM("再次 Ctrl+C 退出，或输入 exit"));
      process.stdout.write("\n");
      this.writeInputValue();
      this.syncCursor();
      return;
    }

    this.lastEmptyCtrlCAt = 0;
    this.lastClearedDraft = this.input.value;
    this.input.clear();
    this.backToPrompt();
    process.stdout.write(S.r("^C") + " " + DIM("草稿已清空，Ctrl+Z 恢复"));
    process.stdout.write("\n");
    this.writeInputValue();
    this.syncCursor();
  }

  private handleCtrlZ(): void {
    if (this.input.value) {
      this.backToPrompt();
      process.stdout.write(S.y("当前输入不会被覆盖，草稿未恢复"));
      process.stdout.write("\n");
      this.writeInputValue();
      this.syncCursor();
      return;
    }

    if (!this.lastClearedDraft) {
      this.backToPrompt();
      process.stdout.write(S.y("没有可恢复的草稿"));
      process.stdout.write("\n");
      this.writeInputValue();
      this.syncCursor();
      return;
    }

    for (const ch of this.lastClearedDraft) {
      if (ch === "\n") {
        this.input.insertNewline();
      } else {
        this.input.insertChar(ch);
      }
    }
    this.lastClearedDraft = null;
    this.backToPrompt();
    process.stdout.write(S.g("已恢复草稿"));
    process.stdout.write("\n");
    this.writeInputValue();
    this.syncCursor();
  }

  private handleBackspace(): void {
    this.input.backspace();
    this.slashCompletionSelectedIndex = 0;
    this.redrawInput();
  }

  private handleCtrlA(): void {
    this.input.moveStart();
    this.redrawInput();
  }

  private handleCtrlE(): void {
    this.input.moveEnd();
    this.redrawInput();
  }

  private handleCtrlU(): void {
    this.input.deleteBeforeCursor();
    this.redrawInput();
  }

  private handleCtrlK(): void {
    this.input.deleteAfterCursor();
    this.redrawInput();
  }

  private handleCtrlW(): void {
    this.input.deleteWordBeforeCursor();
    this.redrawInput();
  }

  private handleAltD(): void {
    this.input.deleteWordAfterCursor();
    this.redrawInput();
  }

  private handleDelete(): void {
    this.input.deleteAfterCursorChar();
    this.redrawInput();
  }

  private handleCtrlL(): void {
    process.stdout.write("\x1b[2J\x1b[H");
    this.printHeader();
    this.printInputBar();
    this.syncCursor();
  }

  private handleCtrlO(): void {
    this.expandLongToolOutput = !this.expandLongToolOutput;
    this.backToPrompt();
    const state = this.expandLongToolOutput ? "展开后续工具输出" : "折叠后续工具输出";
    process.stdout.write(S.s("长输出：") + DIM(state));
    process.stdout.write("\n");
    this.writeInputValue();
    this.syncCursor();
  }

  private handleCtrlD(): void {
    if (this.input.value) {
      this.backToPrompt();
      process.stdout.write(S.y("非空输入不会退出，草稿已保留"));
      process.stdout.write("\n");
      this.writeInputValue();
      this.syncCursor();
      return;
    }
    this.lastEmptyCtrlCAt = 0;
    if (this.inputCallback) {
      this.inputCallback("exit");
    }
  }

  private handleHistoryUp(): void {
    if (this.moveSlashCompletionSelection(-1)) return;
    this.input.historyUp();
    this.redrawInput();
  }

  private handleHistoryDown(): void {
    if (this.moveSlashCompletionSelection(1)) return;
    this.input.historyDown();
    this.redrawInput();
  }

  private handleHistorySearch(): void {
    const matched = this.input.searchHistory();
    if (!matched) {
      this.backToPrompt();
      process.stdout.write(S.y("无匹配历史"));
      process.stdout.write("\n");
      this.writeInputValue();
      this.syncCursor();
      return;
    }
    this.redrawInput();
  }

  private handleLeft(): void {
    this.input.moveLeft();
    this.syncCursor();
  }

  private handleRight(): void {
    this.input.moveRight();
    this.syncCursor();
  }

  private handleWordLeft(): void {
    this.input.moveWordLeft();
    this.syncCursor();
  }

  private handleWordRight(): void {
    this.input.moveWordRight();
    this.syncCursor();
  }

  private handleLineUp(): void {
    this.input.moveLineUp();
    this.syncCursor();
  }

  private handleLineDown(): void {
    this.input.moveLineDown();
    this.syncCursor();
  }

  private handleHome(): void {
    this.input.moveStart();
    this.redrawInput();
  }

  private handleEnd(): void {
    this.input.moveEnd();
    this.redrawInput();
  }

  private handleChar(ch: string): void {
    this.input.insertChar(ch);
    this.slashCompletionSelectedIndex = 0;
    this.redrawInput();
  }

  private handleNewline(): void {
    this.input.insertNewline();
    this.redrawInput();
  }

  // ── 工具块渲染 ────────────────────────────────────

  private printToolHeader(tool: string, command: string, status: "running" | "success" | "error", durationMs = 0): void {
    const w = process.stdout.columns || 100;
    const row = formatToolTimelineRow({ tool, command, status, durationMs, width: w });
    const color = status === "error" ? S.r : status === "success" ? S.g : S.m;
    process.stdout.write("\n" + color(row));
  }

  private printToolOutput(output: string, status: "success" | "error"): void {
    const lines = output.split("\n");
    const isLong = lines.length > 12;
    if (isLong && this.expandLongToolOutput) {
      for (const line of lines) {
        process.stdout.write("  " + DIM(line) + "\n");
      }
      const expandedMsg = "... " + lines.length + " lines total  " + S.d("(Ctrl+O to collapse future long output)");
      process.stdout.write("  " + DIM(expandedMsg) + "\n");
      return;
    }
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
    process.stdout.write("\n" + S.m(formatRoleHeader("executing")));
    this.printToolHeader(tool, command, "running");
  }

  appendToolSuccess(tool: string, command: string, output: string, durationMs: number): void {
    if (this.currentToolRunning) {
      this.currentToolRunning = false;
    }
    this.printToolHeader(tool, command, "success", durationMs);
    process.stdout.write("\n");
    if (output.trim()) {
      this.printToolOutput(output, "success");
    }
  }

  appendToolError(tool: string, command: string, error: string, durationMs: number): void {
    if (this.currentToolRunning) {
      this.currentToolRunning = false;
    }
    this.printToolHeader(tool, command, "error", durationMs);
    process.stdout.write("\n  " + S.r("Error: ") + S.r(error.split("\n")[0]) + "\n");
    const rest = error.split("\n");
    if (rest.length > 1) {
      this.printToolOutput(rest.slice(1).join("\n"), "error");
    }
  }

  appendThinking(text: string): void {
    const lines = text.split("\n").filter((l) => l.trim());
    if (lines.length === 0) return;
    process.stdout.write("\n" + S.p(formatRoleHeader("assistant")) + "\n");
    process.stdout.write(lines[0]);
    for (let i = 1; i < lines.length; i++) {
      process.stdout.write("\n" + lines[i]);
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

  appendOutput(text: string): void {
    const lines = text.split("\n");
    for (const line of lines) {
      process.stdout.write(line.trim() ? "\n" + S.b("› ") + line : "\n");
    }
  }

  appendUserInput(text: string): void {
    const lines = text.split("\n");
    process.stdout.write("\n" + S.s(formatRoleHeader("user")) + "\n");
    for (const line of lines) {
      process.stdout.write(line + "\n");
    }
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
    process.stdout.write("\n" + S.p(formatRoleHeader("assistant")) + "\n");
    if (this.shouldBoxFinalLines(lines)) {
      for (const line of formatResultBox(lines, process.stdout.columns || 100)) {
        process.stdout.write(S.d(line) + "\n");
      }
      return;
    }
    for (const line of lines) {
      if (line.trim()) {
        process.stdout.write(line + "\n");
      }
    }
  }

  private shouldBoxFinalLines(lines: string[]): boolean {
    const nonEmpty = lines.filter((line) => line.trim());
    if (nonEmpty.length < 2) return false;
    return nonEmpty.some((line) => /[├└│─]/.test(line) || /^\s*[./\w-]+\/\s*$/.test(line));
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
    process.stdout.write("\n" + S.g("☑ 分析完成") + " " + DIM(dur));
  }
}
