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
import { default as stringWidth } from "string-width";
import { findSlashCompletion, formatSlashCommandPanel, formatGroupedSlashPanel } from "../commands/index.js";
import { InputBuffer } from "./input-buffer.js";
import { formatProgressPulse } from "./progress.js";
import {
  formatWelcomeGuide,
  formatRoleHeader,
  formatResultHighlight,
  formatToolOutputCard,
  formatToolTimelineRow,
  formatTopBar,
  padVisible,
  truncateVisible,
} from "./shell.js";
import { formatMarkdownForTerminal } from "./markdown.js";
import { getPackageVersion } from "../package-version.js";

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

type DraftDisplaySource = "typed" | "pasted";

export class StreamUI {
  private model: string;
  private tools: number;
  private chromeStatus: {
    tokens?: number;
    branch?: string | null;
    workspace?: string;
    ready?: boolean;
    permissionMode?: string;
    sessionMode?: string;
    memoryStatus?: string;
  } = {};
  private input = new InputBuffer();
  private running: boolean = false;
  private inputCallback: ((cmd: string) => Promise<void>) | null = null;
  private currentToolRunning: boolean = false;
  private dataHandler: ((chunk: string) => void) | null = null;
  private resizeHandler: (() => void) | null = null;
  private statusLine: string | null = null;
  private statusLineEnabled = true;
  private progressTimer: NodeJS.Timeout | null = null;
  private progressStartedAt = 0;
  private progressLabel = "agent";
  private lastEmptyCtrlCAt = 0;
  private lastClearedDraft: string | null = null;
  private lastClearedDraftDisplaySource: DraftDisplaySource | null = null;
  private draftDisplaySource: DraftDisplaySource | null = null;
  private expandLongToolOutput = false;
  private lastInputContentLineCount = 1;
  private lastInputCursorLineIndex = 0;
  private lastInputHintLineCount = 0;
  private slashCompletionSelectedIndex = 0;
  private inputCursorAnchor: "current" | "bottom" = "current";
  private inputStartRow = 0;
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
    if (this.resizeHandler) {
      process.stdout.off("resize", this.resizeHandler);
      this.resizeHandler = null;
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

  setChromeStatus(status: {
    tokens?: number;
    branch?: string | null;
    workspace?: string;
    ready?: boolean;
    permissionMode?: string;
    sessionMode?: string;
    memoryStatus?: string;
  }): void {
    this.chromeStatus = { ...this.chromeStatus, ...status };
  }

  setModel(model: string): void {
    const next = String(model ?? "").trim();
    if (next) this.model = next;
  }

  isExpandLongToolOutput(): boolean {
    return this.expandLongToolOutput;
  }

  setExpandLongToolOutput(expanded: boolean): void {
    this.expandLongToolOutput = Boolean(expanded);
  }

  toggleExpandLongToolOutput(): boolean {
    this.expandLongToolOutput = !this.expandLongToolOutput;
    return this.expandLongToolOutput;
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
      version: getPackageVersion(),
      model: this.model,
      workspace: this.chromeStatus.workspace ?? process.cwd(),
      tokens: this.chromeStatus.tokens ?? 0,
      branch: this.chromeStatus.branch ?? "-",
      ready: this.chromeStatus.ready ?? true,
      sessionMode: this.chromeStatus.sessionMode ?? "agent",
      permissionMode: this.chromeStatus.permissionMode ?? "ask",
      width,
    });
    // 批量写入减少闪烁
    const chunks: string[] = [S.p(lines[0]) + "\n", S.d(lines[1]) + "\n"];
    const homeSnap = {
      model: this.model,
      workspace: this.chromeStatus.workspace,
      memoryStatus: this.chromeStatus.memoryStatus || "本地",
      permissionMode: this.chromeStatus.permissionMode || "ask",
      recentSessions: [],
      width,
    };
    for (const line of formatWelcomeGuide(width, homeSnap)) {
      chunks.push(DIM(line) + "\n");
    }
    process.stdout.write(chunks.join(""));
  }

  // ── 底部输入栏 ────────────────────────────────────

  /**
   * 输入框上方不再堆叠 statusline / 快捷键黑灰提示（去噪）。
   * 详情仍可通过 /statusline、/shortcuts 与顶栏查看。
   */
  private printPromptHint(): void {
    // intentionally empty — keep input chrome minimal
  }

  private printInputBar(): void {
    this.printPromptHint();
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

  private appendFeedbackAndRedraw(message: string, usePlaceholder = false): void {
    this.moveAfterInputFrame();
    process.stdout.write("\n" + message + "\n");
    this.writeInputValue(usePlaceholder);
    this.syncCursor();
  }

  private wrapInputVisualLines(value: string, width: number, cursor: number): {
    lines: string[];
    cursorRow: number;
    cursorCol: number;
  } {
    if (width <= 0) {
      return { lines: [value], cursorRow: 0, cursorCol: 0 };
    }
    const lines: string[] = [""];
    let currentWidth = 0;
    let cursorRow = 0;
    let cursorCol = 0;
    let charIndex = 0;

    const chars = Array.from(value);
    for (const ch of chars) {
      if (charIndex === cursor) {
        cursorRow = lines.length - 1;
        cursorCol = currentWidth;
      }

      if (ch === "\n") {
        lines.push("");
        currentWidth = 0;
        charIndex += 1;
        continue;
      }

      const w = sw(ch);
      if (currentWidth + w > width) {
        lines.push("");
        currentWidth = 0;
      }

      lines[lines.length - 1] += ch;
      currentWidth += w;
      charIndex += ch.length;
    }

    if (charIndex === cursor) {
      cursorRow = lines.length - 1;
      cursorCol = currentWidth;
    }

    return { lines, cursorRow, cursorCol };
  }

  private formatByteSize(value: string): string {
    const bytes = Buffer.byteLength(value, "utf8");
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 10) return `${kb.toFixed(1)} KB`;
    return `${Math.round(kb)} KB`;
  }

  private countInputLines(value: string): number {
    if (!value) return 0;
    return value.split("\n").length;
  }

  private shouldUseCompactDraft(value: string, wrappedLineCount: number, isPlaceholder: boolean): boolean {
    return !isPlaceholder && Boolean(value) && (value.includes("\n") || wrappedLineCount > 1);
  }

  private formatDraftChip(value: string): string {
    const source = this.draftDisplaySource === "pasted" ? "pasted" : "typed";
    const size = this.formatByteSize(value);
    if (source === "pasted") {
      const lines = this.countInputLines(value);
      if (lines > 1) {
        return `[Pasted: ${lines} lines]`;
      }
      return `[Pasted: ${size}]`;
    }
    return `[Draft: ${this.countInputLines(value)} lines, ${size}]`;
  }

  private resetDraftDisplaySourceIfEmpty(): void {
    if (!this.input.value) {
      this.draftDisplaySource = null;
    }
  }

  private markPastedDraft(): void {
    if (this.input.value) {
      this.draftDisplaySource = "pasted";
    }
  }

  private formatInputFrameBorder(left: string, right: string, label: string, totalWidth: number): string {
    if (!label) {
      return left + "─".repeat(totalWidth - 2) + right;
    }
    const text = " " + label + " ";
    const textLen = sw(text);
    const borderLen = totalWidth - 2;
    if (borderLen <= textLen) {
      return left + text.slice(0, borderLen) + right;
    }
    const leftDash = Math.floor((borderLen - textLen) / 2);
    const rightDash = borderLen - textLen - leftDash;
    return left + "─".repeat(leftDash) + text + "─".repeat(rightDash) + right;
  }

  private syncCursor(): void {
    const contentWidth = this.inputFrameContentWidth();
    const wrapWidth = contentWidth - 2;
    const wrapped = this.wrapInputVisualLines(this.input.value, wrapWidth, this.input.cursorPos);
    const compactDraft = this.shouldUseCompactDraft(this.input.value, wrapped.lines.length, false);
    const cursor = compactDraft
      ? { lineIndex: 2, columnText: " ".repeat(Math.min(contentWidth - 1, 2 + sw(this.formatDraftChip(this.input.value)))) }
      : this.inputCursorPosition(wrapped);

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
    const col = 5 + cursor.columnText.length;
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

  private inputCursorPosition(wrapped: { cursorRow: number; cursorCol: number; lines: string[] }): { lineIndex: number; columnText: string } {
    const visualCursorRow = wrapped.cursorRow - this.inputStartRow;
    return {
      lineIndex: 2 + visualCursorRow,
      columnText: " ".repeat(wrapped.cursorCol),
    };
  }

  private moveToInputContentStart(): void {
    const rowsUp = this.inputCursorAnchor === "bottom"
      ? this.lastInputContentLineCount + this.lastInputHintLineCount
      : Math.max(0, this.lastInputCursorLineIndex - 1);
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
    const valueToWrap = this.input.value || (usePlaceholder ? "输入任务，或按 / 打开命令面板" : "");
    const isPlaceholder = !this.input.value && usePlaceholder;

    const wrapWidth = contentWidth - 2;
    const wrapped = this.wrapInputVisualLines(valueToWrap, wrapWidth, isPlaceholder ? 0 : this.input.cursorPos);
    const compactDraft = this.shouldUseCompactDraft(this.input.value, wrapped.lines.length, isPlaceholder);

    const visibleCount = compactDraft ? 1 : Math.min(5, wrapped.lines.length);
    if (wrapped.cursorRow < this.inputStartRow) {
      this.inputStartRow = wrapped.cursorRow;
    } else if (wrapped.cursorRow >= this.inputStartRow + 5) {
      this.inputStartRow = wrapped.cursorRow - 4;
    }
    if (compactDraft) {
      this.inputStartRow = 0;
    } else {
      this.inputStartRow = Math.max(0, Math.min(this.inputStartRow, wrapped.lines.length - visibleCount));
    }

    const visibleLines = compactDraft
      ? [this.formatDraftChip(this.input.value)]
      : wrapped.lines.slice(this.inputStartRow, this.inputStartRow + visibleCount);

    const topLabel = !compactDraft && this.inputStartRow > 0
      ? "▲ 更多内容 (当前第 " + (wrapped.cursorRow + 1) + " 行)"
      : "";
    const bottomLabel = !compactDraft && this.inputStartRow + visibleCount < wrapped.lines.length
      ? "▼ 更多内容 (共 " + wrapped.lines.length + " 行)"
      : "";

    const frameWidth = contentWidth + 4;
    const topBorder = this.formatInputFrameBorder("┌", "┐", topLabel, frameWidth);
    const bottomBorder = this.formatInputFrameBorder("└", "┘", bottomLabel, frameWidth);

    // 批量拼串后一次写出，降低 Windows 终端重绘闪烁
    const chunks: string[] = [S.p(topBorder)];

    for (let i = 0; i < visibleLines.length; i++) {
      const absoluteRow = this.inputStartRow + i;
      const prefix = compactDraft || absoluteRow === 0 ? "› " : "  ";
      const textLine = visibleLines[i] ?? "";
      const contentText = textLine;
      const rendered = truncateVisible(prefix + contentText, contentWidth);
      chunks.push("\n" + S.p("│ " + padVisible(rendered, contentWidth) + " │"));
    }

    chunks.push("\n" + S.p(bottomBorder));

    let extraHint = "";
    if (compactDraft) {
      extraHint = S.y("多行草稿：Enter 发送全部内容");
    }
    if (extraHint) {
      chunks.push("\n" + extraHint);
    }

    const hints = this.formatCurrentSlashCompletionHints();
    for (const hint of hints) {
      chunks.push("\n" + DIM(hint));
    }

    process.stdout.write(chunks.join(""));

    this.lastInputContentLineCount = 1 + visibleLines.length + 1;
    this.lastInputHintLineCount = hints.length + (extraHint ? 1 : 0);

    const cursor = compactDraft
      ? { lineIndex: 2, columnText: " ".repeat(Math.min(contentWidth - 1, 2 + sw(this.formatDraftChip(this.input.value)))) }
      : this.inputCursorPosition(wrapped);
    this.lastInputCursorLineIndex = cursor.lineIndex;

    this.inputCursorAnchor = "bottom";
  }

  private formatCurrentSlashCompletionHints(): string[] {
    if (!this.isSlashCompletionActive(this.input.value)) return [];
    const matches = findSlashCompletion(this.input.value, 8);
    if (matches.length > 0 && this.slashCompletionSelectedIndex >= matches.length) {
      this.slashCompletionSelectedIndex = 0;
    }
    const inputVal = this.input.value || "";
    if (inputVal === "/" || inputVal === "") {
      return formatGroupedSlashPanel(process.stdout.columns || 80);
    }
    return formatSlashCommandPanel(inputVal, this.slashCompletionSelectedIndex, process.stdout.columns || 80, 8);
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
    this.draftDisplaySource = null;
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
    this.inputStartRow = 0;
    process.stdout.write("\n");
    this.printPromptHint();
    this.writeInputValue(true);
    this.syncCursor();
  }

  /** 测试与 slash 复用：当前是否默认展开长工具输出 */
  getExpandLongToolOutput(): boolean {
    return this.expandLongToolOutput;
  }

  // ── 键盘输入处理 ─────────────────────────────────

  private setupInput(): void {
    if (typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(true);
    }

    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    this.resizeHandler = () => {
      if (this.running) {
        this.redrawInput();
      }
    };
    process.stdout.on("resize", this.resizeHandler);

    let partial = "";
    let bracketedPaste = false;
    let pasteSawCarriageReturn = false;

    this.dataHandler = (chunk: string) => {
      if (!this.running) return;
      if (chunk === "\x1b") {
        partial = "";
        return;
      }

      // 非 bracketed 粘贴保护
      let isMultilinePaste = false;
      if (!bracketedPaste && !chunk.includes("\x1b") && chunk.length > 1) {
        const normalized = chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        const withoutTrailing = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
        if (withoutTrailing.includes("\n")) {
          isMultilinePaste = true;
        }
      }

      if (isMultilinePaste) {
        const normalized = chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        for (const ch of normalized) {
          if (ch === "\n") {
            this.input.insertNewline();
          } else if (ch >= " " || ch === "\t") {
            this.input.insertChar(ch);
          }
        }
        this.markPastedDraft();
        this.redrawInput();
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
          this.markPastedDraft();
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
    this.inputStartRow = 0;
    this.moveAfterInputFrame();
    process.stdout.write("\n");
    this.input.submit();
    this.draftDisplaySource = null;
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

    this.appendFeedbackAndRedraw(S.y("Tab agents 仅在空输入时打开；当前草稿已保留，补全未启用"));
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

      this.appendFeedbackAndRedraw(S.r("^C") + " " + DIM("再次 Ctrl+C 退出，或输入 exit"), true);
      return;
    }

    this.lastEmptyCtrlCAt = 0;
    this.lastClearedDraft = this.input.value;
    this.lastClearedDraftDisplaySource = this.draftDisplaySource;
    this.input.clear();
    this.draftDisplaySource = null;
    this.inputStartRow = 0;
    this.appendFeedbackAndRedraw(S.r("^C") + " " + DIM("草稿已清空，Ctrl+Z 恢复"), true);
  }

  private handleCtrlZ(): void {
    if (this.input.value) {
      this.appendFeedbackAndRedraw(S.y("当前输入不会被覆盖，草稿未恢复"));
      return;
    }

    if (!this.lastClearedDraft) {
      this.appendFeedbackAndRedraw(S.y("没有可恢复的草稿"), true);
      return;
    }

    for (const ch of this.lastClearedDraft) {
      if (ch === "\n") {
        this.input.insertNewline();
      } else {
        this.input.insertChar(ch);
      }
    }
    this.draftDisplaySource = this.lastClearedDraftDisplaySource;
    this.lastClearedDraft = null;
    this.lastClearedDraftDisplaySource = null;
    this.appendFeedbackAndRedraw(S.g("已恢复草稿"));
  }

  private handleBackspace(): void {
    const beforeValue = this.input.value;
    const beforeCursor = this.input.cursorPos;
    this.input.backspace();
    if (this.input.value === beforeValue && this.input.cursorPos === beforeCursor) {
      this.syncCursor();
      return;
    }
    this.resetDraftDisplaySourceIfEmpty();
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
    this.resetDraftDisplaySourceIfEmpty();
    this.redrawInput();
  }

  private handleCtrlK(): void {
    this.input.deleteAfterCursor();
    this.resetDraftDisplaySourceIfEmpty();
    this.redrawInput();
  }

  private handleCtrlW(): void {
    this.input.deleteWordBeforeCursor();
    this.resetDraftDisplaySourceIfEmpty();
    this.redrawInput();
  }

  private handleAltD(): void {
    this.input.deleteWordAfterCursor();
    this.resetDraftDisplaySourceIfEmpty();
    this.redrawInput();
  }

  private handleDelete(): void {
    const beforeValue = this.input.value;
    const beforeCursor = this.input.cursorPos;
    this.input.deleteAfterCursorChar();
    if (this.input.value === beforeValue && this.input.cursorPos === beforeCursor) {
      this.syncCursor();
      return;
    }
    this.resetDraftDisplaySourceIfEmpty();
    this.redrawInput();
  }

  private handleCtrlL(): void {
    process.stdout.write("\x1b[2J\x1b[H");
    this.printHeader();
    this.printInputBar();
    this.syncCursor();
  }

  private handleCtrlO(): void {
    const expanded = this.toggleExpandLongToolOutput();
    const state = expanded ? "展开后续工具输出" : "折叠后续工具输出";
    this.appendFeedbackAndRedraw(S.s("长输出：") + DIM(state), !this.input.value);
  }

  private handleCtrlD(): void {
    if (this.input.value) {
      this.appendFeedbackAndRedraw(S.y("非空输入不会退出，草稿已保留"));
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
    this.draftDisplaySource = this.input.value ? "typed" : null;
    this.redrawInput();
  }

  private handleHistoryDown(): void {
    if (this.moveSlashCompletionSelection(1)) return;
    this.input.historyDown();
    this.draftDisplaySource = this.input.value ? "typed" : null;
    this.redrawInput();
  }

  private handleHistorySearch(): void {
    const matched = this.input.searchHistory();
    if (!matched) {
      this.appendFeedbackAndRedraw(S.y("无匹配历史"));
      return;
    }
    this.draftDisplaySource = this.input.value ? "typed" : null;
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
    if (this.draftDisplaySource !== "pasted") {
      this.draftDisplaySource = "typed";
    }
    this.slashCompletionSelectedIndex = 0;
    this.redrawInput();
  }

  private handleNewline(): void {
    this.input.insertNewline();
    if (this.draftDisplaySource !== "pasted") {
      this.draftDisplaySource = "typed";
    }
    this.redrawInput();
  }

  // ── 工具块渲染 ────────────────────────────────────

  private printToolHeader(tool: string, command: string, status: "running" | "success" | "error", durationMs = 0): void {
    const w = process.stdout.columns || 100;
    const row = formatToolTimelineRow({ tool, command, status, durationMs, width: w });
    const color = status === "error" ? S.r : status === "success" ? S.g : S.m;
    process.stdout.write("\n" + color(row));
  }

  private printToolOutput(output: string, _status: "success" | "error"): void {
    const card = formatToolOutputCard(output, {
      expand: this.expandLongToolOutput,
      maxTop: 8,
      maxBottom: 2,
      longThreshold: 12,
    });
    const chunks: string[] = [];
    for (const line of card.displayLines) {
      chunks.push("  " + DIM(line) + "\n");
    }
    if (card.footer) {
      chunks.push("  " + DIM(card.footer) + "\n");
    }
    if (chunks.length > 0) {
      process.stdout.write(chunks.join(""));
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
    const width = process.stdout.columns || 100;
    const mdWidth = Math.max(40, width - 4);
    const mdLines = formatMarkdownForTerminal(text, { width: mdWidth });
    process.stdout.write("\n" + S.p(BOLD(formatRoleHeader("assistant"))) + "  " + S.g(BOLD("结果")) + "\n");
    const box = formatResultHighlight({
      header: "结果",
      lines: mdLines,
      width,
    });
    for (let i = 0; i < box.length; i++) {
      const line = box[i];
      // 顶/底与左右边框用强调色；正文保留 Markdown 原色
      if (i === 0 || i === box.length - 1) {
        process.stdout.write(S.g(BOLD(line)) + "\n");
      } else if (line.startsWith("│ ") && line.endsWith(" │")) {
        const mid = line.slice(2, line.length - 2);
        process.stdout.write(S.g("│ ") + mid + S.g(" │") + "\n");
      } else {
        process.stdout.write(S.g(line) + "\n");
      }
    }
  }

  appendError(text: string): void {
    process.stdout.write("\n" + S.r("● error") + "  " + S.r(text));
  }

  appendState(from: string, to: string): void {
    process.stdout.write("\n" + DIM("[state] ") + S.y(from) + " " + DIM("→") + " " + S.g(to));
  }

  appendDone(durationMs: number): void {
    const dur = fmtDur(durationMs);
    process.stdout.write("\n" + S.g(BOLD("☑ 任务完成")) + "  " + S.p(dur) + "\n");
  }
}
