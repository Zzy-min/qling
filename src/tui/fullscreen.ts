import stringWidth from "string-width";
import { getPackageVersion } from "../package-version.js";
import { formatMarkdownForTerminal } from "./markdown.js";
import {
  modeAccentHex,
  modeInputTopLabel,
  modePromptPrefix,
  resolveGrokUiMode,
} from "./mode-chrome.js";
import {
  contentOffsetToScrollOffset,
  scrollbarClickToOffset,
  scrollbarThumb,
  scrollOffsetToContentOffset,
  type ScrollbarThumb,
} from "./scrollbar.js";
import { extractImportantSteps } from "./thinking-fold.js";
import { fg, paint } from "./theme.js";

export type TuiMode = "auto" | "fullscreen" | "classic";
export type TuiIconMode = "unicode" | "nerd";

export interface TerminalCapabilities {
  stdinTTY: boolean;
  stdoutTTY: boolean;
  columns: number;
  rows: number;
  colorMode?: "truecolor" | "ansi256" | "none";
}

export interface FullscreenChrome {
  workspace: string;
  model: string;
  ready: boolean;
  tokens: number;
  branch: string;
  sessionMode?: string;
  permissionMode?: string;
}

type Entry =
  | { kind: "user" | "result" | "notice" | "error"; text: string }
  | { kind: "assistant"; text: string; streaming?: boolean }
  | { kind: "thinking"; text: string; durationMs?: number }
  | { kind: "tool"; tool: string; command: string; status: "running" | "success" | "error"; durationMs?: number; output?: string };

interface ScrollbarHit {
  column: number;
  firstRow: number;
  trackCells: number;
  totalLines: number;
  viewportLines: number;
  maxOffset: number;
}

export interface FullscreenMouseEvent {
  kind: "down" | "drag" | "up";
  column: number;
  row: number;
}

/**
 * 对标 grok-build `xai-grok-pager/src/app/event_loop.rs` `drain_and_process`：
 * 当单个输入批次中包含连续的鼠标 `drag` 事件时，仅保留最新的 `drag` 终点坐标，
 * 同时完整保留 `down` / `up` 边界，避免单次 I/O 批次触发数十次冗余重绘。
 */
export function coalesceMouseEvents(
  events: readonly FullscreenMouseEvent[]
): FullscreenMouseEvent[] {
  if (events.length <= 1) return [...events];
  const coalesced: FullscreenMouseEvent[] = [];
  for (const event of events) {
    if (
      event.kind === "drag" &&
      coalesced.length > 0 &&
      coalesced[coalesced.length - 1]?.kind === "drag"
    ) {
      coalesced[coalesced.length - 1] = event;
    } else {
      coalesced.push(event);
    }
  }
  return coalesced;
}

interface SelectionPoint {
  line: number;
  column: number;
}

interface EntryCacheRecord {
  width: number;
  expandThinking: boolean;
  expandToolOutput: boolean;
  styledLines: string[];
  plainLines: string[];
}

interface BodyCacheRecord {
  entriesRevision: number;
  expandThinking: boolean;
  expandToolOutput: boolean;
  transientOutput: string | null;
  progressLabel: string | null;
  progressDuration: string;
  overlayRef: string[] | null;
  styledLines: string[];
  plainLines: string[];
}

export function parseTuiMode(value: string | null | undefined): TuiMode | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "auto" || normalized === "fullscreen" || normalized === "classic"
    ? normalized
    : null;
}

export function resolveTuiMode(
  requested: string | null | undefined,
  capabilities: TerminalCapabilities
): "fullscreen" | "classic" {
  const mode = parseTuiMode(requested) ?? "auto";
  const capable =
    capabilities.stdinTTY &&
    capabilities.stdoutTTY &&
    capabilities.columns >= 80 &&
    capabilities.rows >= 24;
  if (mode === "classic") return "classic";
  if (mode === "fullscreen") return capable ? "fullscreen" : "classic";
  return capable ? "fullscreen" : "classic";
}

export function resolveIconMode(value: string | null | undefined): TuiIconMode {
  return String(value ?? "").trim().toLowerCase() === "nerd" ? "nerd" : "unicode";
}

export function consumeMouseWheel(
  chunk: string,
  linesPerNotch = 3
): { rest: string; lineDelta: number } {
  const parsed = consumeMouseInput(chunk, linesPerNotch);
  return { rest: parsed.rest + parsed.pending, lineDelta: parsed.lineDelta };
}

export function consumeMouseInput(
  chunk: string,
  linesPerNotch = 3
): {
  rest: string;
  pending: string;
  lineDelta: number;
  events: FullscreenMouseEvent[];
} {
  let lineDelta = 0;
  const events: FullscreenMouseEvent[] = [];
  const incomplete = chunk.match(/\x1b\[<[\d;]*$/);
  const pending = incomplete?.[0] ?? "";
  const complete = pending ? chunk.slice(0, -pending.length) : chunk;
  const rest = complete.replace(
    /\x1b\[<(\d+);(\d+);(\d+)([mM])/g,
    (_sequence, rawCode: string, rawColumn: string, rawRow: string, phase: string) => {
      const code = Number(rawCode);
      const column = Math.max(1, Number(rawColumn) || 1);
      const row = Math.max(1, Number(rawRow) || 1);
      if ((code & 64) !== 0) {
        if (phase === "M") {
          lineDelta += (code & 1) === 0 ? linesPerNotch : -linesPerNotch;
        }
        return "";
      }
      if ((code & 3) !== 0) return "";
      if (phase === "m") {
        events.push({ kind: "up", column, row });
      } else if ((code & 32) !== 0) {
        events.push({ kind: "drag", column, row });
      } else {
        events.push({ kind: "down", column, row });
      }
      return "";
    }
  );
  return { rest, pending, lineDelta, events };
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

function compareSelectionPoint(left: SelectionPoint, right: SelectionPoint): number {
  return left.line - right.line || left.column - right.column;
}

function sliceVisibleCells(value: string, startCell: number, endCell: number): string {
  if (endCell <= startCell) return "";
  let cell = 0;
  let output = "";
  for (const char of value) {
    const width = Math.max(0, stringWidth(char));
    const next = cell + width;
    if (next > startCell && cell < endCell) output += char;
    cell = next;
    if (cell >= endCell) break;
  }
  return output;
}

function highlightVisibleCells(value: string, startCell: number, endCell: number): string {
  if (endCell <= startCell) return value;
  let cell = 0;
  let selected = false;
  let output = "";
  for (let index = 0; index < value.length;) {
    const ansi = value.slice(index).match(/^\x1b\[[0-9;]*m/);
    if (ansi) {
      output += ansi[0];
      // Color/style sequences inside Markdown (especially inline paths) may
      // include SGR 0/27 and silently cancel the active inverse selection.
      // Reassert inverse after every embedded SGR while this cell range is
      // selected so the visual highlight remains contiguous.
      if (selected) output += "\x1b[7m";
      index += ansi[0].length;
      continue;
    }
    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) break;
    const char = String.fromCodePoint(codePoint);
    const width = Math.max(0, stringWidth(char));
    const next = cell + width;
    const shouldSelect = next > startCell && cell < endCell;
    if (shouldSelect !== selected) {
      output += shouldSelect ? "\x1b[7m" : "\x1b[27m";
      selected = shouldSelect;
    }
    output += char;
    cell = next;
    index += char.length;
  }
  if (selected) output += "\x1b[27m";
  return output;
}

function toAnsi256(value: string): string {
  return value.replace(
    /\x1b\[38;2;(\d+);(\d+);(\d+)m/g,
    (_match, red, green, blue) => {
      const r = Math.round((Number(red) / 255) * 5);
      const g = Math.round((Number(green) / 255) * 5);
      const b = Math.round((Number(blue) / 255) * 5);
      return `\x1b[38;5;${16 + 36 * r + 6 * g + b}m`;
    }
  );
}

export function resolveColorMode(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): "truecolor" | "ansi256" | "none" {
  if (Object.prototype.hasOwnProperty.call(env, "NO_COLOR")) return "none";
  const colorTerm = String(env.COLORTERM ?? "").toLowerCase();
  if (colorTerm.includes("truecolor") || colorTerm.includes("24bit")) return "truecolor";
  return "ansi256";
}

/** 把输入按显示宽度折行，并记下光标落在哪一行。显式换行单独成行。 */
export function wrapFullscreenInput(
  value: string,
  width: number,
  cursorIndex: number
): { lines: string[]; cursorRow: number; cursorCol: number } {
  const safeWidth = Math.max(1, width);
  const lines = [""];
  let current = 0;
  let cursorRow = 0;
  let cursorCol = 0;
  let seen = 0;
  const markCursor = () => {
    cursorRow = lines.length - 1;
    cursorCol = current;
  };
  for (const char of Array.from(value)) {
    if (seen === cursorIndex) markCursor();
    if (char === "\n") {
      lines.push("");
      current = 0;
      seen += char.length;
      continue;
    }
    const charWidth = Math.max(0, stringWidth(char));
    if (current > 0 && charWidth > 0 && current + charWidth > safeWidth) {
      lines.push("");
      current = 0;
    }
    lines[lines.length - 1] += char;
    current += charWidth;
    seen += char.length;
  }
  if (seen === cursorIndex || value.length === 0) markCursor();
  return { lines, cursorRow, cursorCol };
}

function fit(value: string, width: number): string {
  if (width <= 0) return "";
  const plain = stripAnsi(value);
  if (stringWidth(plain) <= width) return value + " ".repeat(width - stringWidth(plain));
  let out = "";
  let used = 0;
  for (const char of plain) {
    const next = stringWidth(char);
    if (used + next > width - 1) break;
    out += char;
    used += next;
  }
  return out + "…" + " ".repeat(Math.max(0, width - used - 1));
}

function basename(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.split("/").filter(Boolean).at(-1) ?? value;
}

function tokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.max(0, Math.floor(value)));
}

function duration(value?: number): string {
  if (value === undefined) return "";
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}s`;
}

export function formatFullscreenHeader(chrome: FullscreenChrome, width: number): string[] {
  const left = width >= 100 ? `◈ 轻灵 Qling  v${getPackageVersion()}` : "◈ 轻灵 Qling";
  const workspace = `Workspace: ${basename(chrome.workspace)}`;
  const model = `Model: ${chrome.model}`;
  const mode =
    chrome.sessionMode === "plan"
      ? "Plan"
      : chrome.permissionMode === "allow" ||
          chrome.permissionMode === "always" ||
          chrome.permissionMode === "always-approve"
        ? "Auto"
        : "Normal";
  const ready = `${chrome.ready ? "● Ready" : "○ Busy"} · ${mode}`;
  const tokens = width >= 100 ? `Tokens: ${tokenCount(chrome.tokens)}` : "";
  const branch = `⌘ Git: ${chrome.branch || "-"}`;
  const segments = width >= 120
    ? [left, workspace, model, ready, tokens, branch]
    : width >= 100
      ? [left, workspace, model, ready, branch]
      : [left, workspace, ready, branch];
  const gap = Math.max(2, Math.floor((width - segments.reduce((sum, item) => sum + stringWidth(item), 0)) / Math.max(1, segments.length - 1)));
  return [fit(segments.join(" ".repeat(gap)), width), "─".repeat(width)];
}

export function formatFullscreenFooterHints(
  _selectionActive: boolean,
  width: number
): string {
  return width >= 120
    ? "拖选复制   Alt+C 重复制   Enter 发送   Ctrl+C 中断   Shift+Tab 模式   /help 帮助   /clear 清空   /model 模型   /exit 退出"
    : "拖选复制 Alt+C重复制 Enter发送 Ctrl+C中断 Shift+Tab模式 / 命令";
}

export class FullscreenRenderer {
  private entries: Entry[] = [];
  private chrome: FullscreenChrome;
  private input = "";
  private inputCursor = 0;
  private cursorColumn = 5;
  private cursorRow = 1;
  private placeholder = "输入任务，/help 查看命令";
  private overlay: string[] | null = null;
  private expandToolOutput = false;
  private expandThinking = false;
  private scrollbarDragging = false;
  private scrollbarHit: ScrollbarHit | null = null;
  private progress: { label: string; elapsedMs: number } | null = null;
  private transientOutput: string | null = null;
  private previous: string[] = [];
  private scrollOffset = 0;
  private maxScrollOffset = 0;
  /** True while the viewport is glued to the newest line. */
  private followTail = true;
  /** Body line kept at the top of the viewport while the user is reading history. */
  private anchoredTop: number | null = null;
  private active = false;
  private selectionAnchor: SelectionPoint | null = null;
  private selectionHead: SelectionPoint | null = null;
  private selectionDragging = false;
  private selectionMoved = false;
  private lastSelectedText: string | null = null;
  private selectionFeedback: string | null = null;
  private logicalBodyPlain: string[] = [];
  private screenBodyRows = new Map<number, number>();
  private visibleBodyFirstRow = 0;
  private visibleBodyLastRow = 0;
  private entriesRevision = 0;
  private entryRenderCache = new WeakMap<Entry, Map<number, EntryCacheRecord>>();
  private bodyCacheByWidth = new Map<number, BodyCacheRecord>();
  private lastDragScrollAt = 0;
  private dragScrollSteps = 0;
  private readonly iconMode: TuiIconMode;
  private readonly writeRaw: (value: string) => void;
  private readonly writeClipboard: (value: string) => void | Promise<void>;
  private readonly now: () => Date;

  constructor(
    chrome: FullscreenChrome,
    private capabilities: TerminalCapabilities,
    options: {
      write?: (value: string) => void;
      now?: () => Date;
      iconMode?: TuiIconMode;
      writeClipboard?: (value: string) => void | Promise<void>;
    } = {}
  ) {
    this.chrome = chrome;
    this.writeRaw = options.write ?? ((value) => process.stdout.write(value));
    this.now = options.now ?? (() => new Date());
    this.iconMode = options.iconMode ?? "unicode";
    this.writeClipboard = options.writeClipboard ?? (() => {});
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.writeRaw(
      "\x1b[?1049h" +
        "\x1b[?1000h\x1b[?1002h\x1b[?1006h" +
        "\x1b[?25l\x1b[2J\x1b[H"
    );
    this.render(true);
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.writeRaw("\x1b[?1006l\x1b[?1002l\x1b[?1000l\x1b[?25h\x1b[?1049l");
    this.previous = [];
  }

  resize(capabilities: TerminalCapabilities): void {
    this.capabilities = capabilities;
    this.previous = [];
    this.render(true);
  }

  updateChrome(patch: Partial<FullscreenChrome>): void {
    this.chrome = { ...this.chrome, ...patch };
    this.render(false, true);
  }

  setInput(value: string, placeholder?: string, cursorIndex = value.length): void {
    this.input = value;
    this.inputCursor = Math.max(0, Math.min(cursorIndex, value.length));
    if (placeholder) this.placeholder = placeholder;
    this.render();
  }

  setProgress(
    label: string | null,
    elapsedMs = 0,
    repairChrome = false
  ): void {
    this.progress = label ? { label, elapsedMs: Math.max(0, elapsedMs) } : null;
    this.render(false, repairChrome);
  }

  setTransientOutput(
    text: string | null,
    input?: { value: string; cursorIndex?: number; placeholder?: string }
  ): void {
    this.transientOutput = text;
    if (input) {
      this.input = input.value;
      this.inputCursor = Math.max(
        0,
        Math.min(input.cursorIndex ?? input.value.length, input.value.length)
      );
      if (input.placeholder) this.placeholder = input.placeholder;
    }
    this.render();
  }

  setOverlay(lines: string[] | null): void {
    this.overlay = lines;
    this.render();
  }

  setExpandToolOutput(expanded: boolean): void {
    this.expandToolOutput = expanded;
    this.render();
  }

  appendUser(text: string): void { this.append({ kind: "user", text }); }
  appendAssistant(text: string): void { this.append({ kind: "assistant", text }); }
  appendResult(text: string): void { this.append({ kind: "result", text }); }
  appendNotice(text: string): void { this.append({ kind: "notice", text }); }
  appendError(text: string): void { this.append({ kind: "error", text }); }
  appendThinking(text: string, durationMs?: number): void {
    const raw = String(text ?? "").trim();
    if (!raw) return;
    this.append({ kind: "thinking", text: raw, durationMs });
  }

  /** Replace a live assistant stream with a collapsed thinking block. */
  foldAssistantIntoThinking(text: string, durationMs?: number): void {
    const raw = String(text ?? "").trim();
    if (!raw) return;
    const previous = this.entries.at(-1);
    const entry: Entry = { kind: "thinking", text: raw, durationMs };
    if (previous?.kind === "assistant" && previous.streaming) {
      this.entries[this.entries.length - 1] = entry;
      this.entriesRevision += 1;
      this.render();
      return;
    }
    this.append(entry);
  }

  finishThinking(durationMs: number): void {
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      const entry = this.entries[index];
      if (entry?.kind === "thinking" && entry.durationMs === undefined) {
        this.entries[index] = { ...entry, durationMs };
        this.entriesRevision += 1;
        this.render();
        return;
      }
    }
  }

  toggleThinking(): boolean {
    if (!this.entries.some((entry) => entry.kind === "thinking")) return false;
    this.expandThinking = !this.expandThinking;
    this.render();
    return true;
  }

  streamAssistant(text: string): void {
    const previous = this.entries.at(-1);
    if (previous?.kind === "assistant" && previous.streaming) {
      this.entries[this.entries.length - 1] = { kind: "assistant", text, streaming: true };
      this.entriesRevision += 1;
      this.render();
      return;
    }
    this.append({ kind: "assistant", text, streaming: true });
  }

  completeAssistant(text: string): void {
    const previous = this.entries.at(-1);
    if (previous?.kind === "assistant" && previous.streaming) {
      this.entries[this.entries.length - 1] = { kind: "assistant", text };
      this.entriesRevision += 1;
      this.render();
      return;
    }
    this.appendAssistant(text);
  }
  appendTool(tool: string, command: string, status: "running" | "success" | "error", durationMs?: number, output?: string): void {
    const previous = this.entries.at(-1);
    if (previous?.kind === "tool" && previous.tool === tool && previous.command === command && previous.status === "running") {
      this.entries[this.entries.length - 1] = { kind: "tool", tool, command, status, durationMs, output };
      this.entriesRevision += 1;
      this.render();
      return;
    }
    this.append({ kind: "tool", tool, command, status, durationMs, output });
  }

  clearEntries(): void {
    this.entries = [];
    this.entriesRevision += 1;
    this.bodyCacheByWidth.clear();
    this.scrollOffset = 0;
    this.followTail = true;
    this.anchoredTop = null;
    this.clearSelection();
    this.render();
  }

  clearConversationView(placeholder = "输入任务，/help 查看命令"): void {
    this.entries = [];
    this.entriesRevision += 1;
    this.bodyCacheByWidth.clear();
    this.transientOutput = null;
    this.progress = null;
    this.overlay = null;
    this.input = "";
    this.inputCursor = 0;
    this.placeholder = placeholder;
    this.scrollOffset = 0;
    this.followTail = true;
    this.anchoredTop = null;
    this.clearSelection();
    this.render();
  }

  scrollLines(delta: number): void {
    const nextOffset = Math.max(
      0,
      Math.min(this.maxScrollOffset, this.scrollOffset + delta)
    );
    if (nextOffset === this.scrollOffset) return;
    this.scrollOffset = nextOffset;
    this.noteUserScroll();
    this.render(false, false);
  }

  scrollPages(delta: number): void {
    const page = Math.max(4, this.capabilities.rows - 8);
    this.scrollLines(delta * page);
  }

  scrollEnd(): void {
    this.scrollOffset = 0;
    this.followTail = true;
    this.anchoredTop = null;
    this.render();
  }

  handleMouse(event: FullscreenMouseEvent): boolean {
    if (this.scrollbarDragging || this.hitScrollbar(event.column, event.row)) {
      if (event.kind === "up") {
        this.scrollbarDragging = false;
        this.applyScrollbar(event.row);
        return true;
      }
      this.scrollbarDragging = true;
      this.selectionDragging = false;
      this.selectionAnchor = null;
      this.selectionHead = null;
      this.selectionMoved = false;
      this.applyScrollbar(event.row);
      return true;
    }
    if (event.kind === "down") {
      const point = this.selectionPointAt(event.column, event.row);
      const hadActiveSelection =
        this.selectionAnchor !== null ||
        this.selectionHead !== null ||
        this.selectionFeedback !== null;
      this.selectionAnchor = point;
      this.selectionHead = point;
      this.selectionDragging = point !== null;
      this.selectionMoved = false;
      this.selectionFeedback = null;
      this.lastDragScrollAt = 0;
      this.dragScrollSteps = 0;
      if (hadActiveSelection) {
        this.render();
      }
      return point !== null;
    }
    if (!this.selectionDragging || !this.selectionAnchor) return false;

    let scrolledDuringDrag = false;
    if (event.kind === "drag") {
      const scrollDelta =
        event.row <= this.visibleBodyFirstRow
          ? 2
          : event.row >= this.visibleBodyLastRow
            ? -2
            : 0;
      if (scrollDelta !== 0) {
        // 对标 grok-build `textarea.rs` `drag_scroll_interval`: 80ms -> 60ms -> 40ms 阶梯节流
        const nowMs = this.now().getTime();
        const minInterval =
          this.dragScrollSteps === 0 ? 80 : this.dragScrollSteps === 1 ? 60 : 40;
        if (this.lastDragScrollAt === 0 || nowMs - this.lastDragScrollAt >= minInterval) {
          this.lastDragScrollAt = nowMs;
          this.dragScrollSteps += 1;
          scrolledDuringDrag = this.applyScrollLinesSilent(scrollDelta);
        }
      } else {
        this.lastDragScrollAt = 0;
        this.dragScrollSteps = 0;
      }
    }
    const prevHead = this.selectionHead;
    const prevMoved = this.selectionMoved;
    const point = this.selectionPointAt(event.column, event.row, true);
    if (point) {
      this.selectionHead = point;
      this.selectionMoved =
        this.selectionMoved ||
        compareSelectionPoint(this.selectionAnchor, point) !== 0;
    }
    if (event.kind === "up") {
      this.selectionDragging = false;
      this.lastDragScrollAt = 0;
      this.dragScrollSteps = 0;
      if (!this.selectionMoved) {
        this.selectionAnchor = null;
        this.selectionHead = null;
        if (prevMoved) this.render();
        return false;
      }
      const text = this.selectedTextFromActiveRange();
      this.selectionAnchor = null;
      this.selectionHead = null;
      this.selectionMoved = false;
      this.lastSelectedText = text;
      const copied = this.copySelection(text);
      this.render();
      return copied;
    }
    // 对标 grok-build `selection.rs` `update_active_text_drag`：
    // 当选区终点与滚动位置均未变化时返回 false，跳过无意义的整帧重绘
    const headChanged =
      !prevHead ||
      !this.selectionHead ||
      compareSelectionPoint(prevHead, this.selectionHead) !== 0 ||
      prevMoved !== this.selectionMoved;
    if (!headChanged && !scrolledDuringDrag) {
      return false;
    }
    this.render();
    return true;
  }

  private applyScrollLinesSilent(delta: number): boolean {
    const nextOffset = Math.max(
      0,
      Math.min(this.maxScrollOffset, this.scrollOffset + delta)
    );
    if (nextOffset === this.scrollOffset) return false;
    this.scrollOffset = nextOffset;
    this.noteUserScroll();
    return true;
  }

  getSelectedText(): string | null {
    return this.selectedTextFromActiveRange() ?? this.lastSelectedText;
  }

  private selectedTextFromActiveRange(): string | null {
    const anchor = this.selectionAnchor;
    const head = this.selectionHead;
    if (!anchor || !head || !this.selectionMoved) return null;
    const [start, end] =
      compareSelectionPoint(anchor, head) <= 0
        ? [anchor, head]
        : [head, anchor];
    const selected: string[] = [];
    for (let line = start.line; line <= end.line; line++) {
      const source = this.logicalBodyPlain[line] ?? "";
      const startCell = line === start.line ? Math.max(0, start.column - 1) : 0;
      const endCell =
        line === end.line ? Math.max(startCell, end.column) : Number.MAX_SAFE_INTEGER;
      selected.push(sliceVisibleCells(source, startCell, endCell));
    }
    return selected.join("\n");
  }

  copySelection(selectedText?: string | null): boolean {
    const text = selectedText ?? this.getSelectedText();
    if (!text) return false;
    try {
      this.selectionFeedback = `复制中 · ${text.length} 字符`;
      void Promise.resolve(this.writeClipboard(text)).then(
        () => {
          this.selectionFeedback = `已复制 · ${text.length} 字符`;
          this.render();
        },
        () => {
          this.selectionFeedback = "复制失败 · 剪贴板不可用";
          this.render();
        }
      );
      return true;
    } catch {
      this.selectionFeedback = "复制失败 · 剪贴板不可用";
      this.render();
      return false;
    }
  }

  snapshot(): string[] {
    return this.compose().map(stripAnsi);
  }

  private append(entry: Entry): void {
    this.entries.push(entry);
    if (this.entries.length > 240) {
      this.entries.splice(0, this.entries.length - 240);
      this.clearSelection();
      this.anchoredTop = null;
    }
    this.entriesRevision += 1;
    this.render();
  }

  private clearSelection(): void {
    this.selectionAnchor = null;
    this.selectionHead = null;
    this.selectionDragging = false;
    this.selectionMoved = false;
    this.lastSelectedText = null;
    this.selectionFeedback = null;
  }

  private selectionPointAt(
    column: number,
    row: number,
    clampToVisible = false
  ): SelectionPoint | null {
    if (this.screenBodyRows.size === 0) return null;
    let resolvedRow = row;
    if (!this.screenBodyRows.has(resolvedRow) && clampToVisible) {
      resolvedRow = Math.max(
        this.visibleBodyFirstRow,
        Math.min(this.visibleBodyLastRow, resolvedRow)
      );
    }
    const line = this.screenBodyRows.get(resolvedRow);
    if (line === undefined) return null;
    return {
      line,
      column: Math.max(1, Math.min(this.capabilities.columns, column)),
    };
  }

  private selectedCellsForLine(line: number): [number, number] | null {
    const anchor = this.selectionAnchor;
    const head = this.selectionHead;
    if (!anchor || !head || (!this.selectionMoved && !this.selectionDragging)) {
      return null;
    }
    const [start, end] =
      compareSelectionPoint(anchor, head) <= 0
        ? [anchor, head]
        : [head, anchor];
    if (line < start.line || line > end.line) return null;
    const startCell = line === start.line ? Math.max(0, start.column - 1) : 0;
    const endCell =
      line === end.line
        ? Math.max(startCell, end.column)
        : Number.MAX_SAFE_INTEGER;
    return [startCell, endCell];
  }

  private entryLines(entry: Entry, width: number): string[] {
    const bodyWidth = Math.max(20, width - 6);
    const userIcon = this.iconMode === "nerd" ? "" : "♟";
    const assistantIcon = this.iconMode === "nerd" ? "󰚩" : "✦";
    if (entry.kind === "user") return [fg("#60A5FA", `${userIcon}  You`), ...entry.text.split("\n").map((line) => `    ${line}`), ""];
    if (entry.kind === "assistant") {
      const label = entry.streaming ? `${assistantIcon}  轻灵  ·  流式` : `${assistantIcon}  轻灵`;
      return [paint.primary(label), ...formatMarkdownForTerminal(entry.text, { width: bodyWidth }).map((line) => `    ${line}`), ""];
    }
    if (entry.kind === "thinking") {
      const folded = extractImportantSteps(entry.text, 3);
      const header = entry.durationMs !== undefined
        ? `◇  思考了 ${duration(entry.durationMs)}`
        : "◇  思考";
      if (this.expandThinking) {
        const markdown = formatMarkdownForTerminal(entry.text, { width: bodyWidth });
        return [
          paint.thinking(header),
          ...markdown.map((line) => paint.dim(`│  ${line}`)),
          paint.dim("   Ctrl+E 折叠"),
          "",
        ];
      }
      const lines = [
        paint.thinking(header),
        ...folded.steps.map((step) => paint.dim(`│  ${step}`)),
      ];
      if (folded.expandable) {
        lines.push(paint.dim(`   … ${folded.hidden > 0 ? `另有 ${folded.hidden} 步 · ` : ""}Ctrl+E 展开`));
      }
      lines.push("");
      return lines;
    }
    if (entry.kind === "notice") {
      return [
        ...entry.text.split(/\r\n?|\n/).map((line) => paint.dim(line)),
        "",
      ];
    }
    if (entry.kind === "error") {
      const lines = entry.text.split(/\r\n?|\n/);
      return [
        ...lines.map((line, index) =>
          paint.error(index === 0 ? `×  ${line}` : `   ${line}`)
        ),
        "",
      ];
    }
    if (entry.kind === "tool") {
      const icon = entry.status === "error" ? "×" : entry.status === "success" ? "✓" : "·";
      const action = /read|file/i.test(entry.tool) ? "读取文件" : /search|list/i.test(entry.tool) ? "读取目录" : /bash|exec|shell/i.test(entry.tool) ? "执行命令" : "工具调用";
      const right = duration(entry.durationMs);
      const base = `│ ${icon}  ${action}    ${entry.command}`;
      const line = right ? fit(base, width - stringWidth(right) - 1) + right : fit(base, width);
      const lines = [entry.status === "running" ? paint.magenta("◯ 正在执行…") : line];
      if (entry.output?.trim()) {
        const outputLines = entry.output.split("\n");
        const visible = this.expandToolOutput
          ? outputLines
          : entry.status === "error"
            ? outputLines.slice(0, 4)
            : [];
        lines.push(...visible.map((value) => `│    ${value}`));
        if (entry.status === "error" && !this.expandToolOutput && outputLines.length > visible.length) {
          lines.push(`│    … ${outputLines.length - visible.length} 行已折叠 · Ctrl+O 展开`);
        }
      }
      return lines;
    }
    const markdown = formatMarkdownForTerminal(entry.text, { width: bodyWidth });
    const top = `╭${"─".repeat(Math.max(1, width - 2))}╮`;
    const bottom = `╰${"─".repeat(Math.max(1, width - 2))}╯`;
    return [paint.success("☑ 分析完成"), fit(top, width), ...markdown.map((line) => `│ ${fit(line, width - 4)} │`), fit(bottom, width), ""];
  }

  private cachedEntryLines(entry: Entry, width: number): EntryCacheRecord {
    let byWidth = this.entryRenderCache.get(entry);
    if (!byWidth) {
      byWidth = new Map<number, EntryCacheRecord>();
      this.entryRenderCache.set(entry, byWidth);
    }
    const existing = byWidth.get(width);
    if (
      existing &&
      existing.expandThinking === this.expandThinking &&
      existing.expandToolOutput === this.expandToolOutput
    ) {
      return existing;
    }
    const styledLines = this.entryLines(entry, width);
    const plainLines = styledLines.map(stripAnsi);
    const record: EntryCacheRecord = {
      width,
      expandThinking: this.expandThinking,
      expandToolOutput: this.expandToolOutput,
      styledLines,
      plainLines,
    };
    byWidth.set(width, record);
    return record;
  }

  private buildBodyWithPlain(width: number): { styledLines: string[]; plainLines: string[] } {
    const progressLabel = this.progress?.label ?? null;
    const progressDuration = this.progress ? duration(this.progress.elapsedMs) : "";
    const cached = this.bodyCacheByWidth.get(width);
    if (
      cached &&
      cached.entriesRevision === this.entriesRevision &&
      cached.expandThinking === this.expandThinking &&
      cached.expandToolOutput === this.expandToolOutput &&
      cached.transientOutput === this.transientOutput &&
      cached.progressLabel === progressLabel &&
      cached.progressDuration === progressDuration &&
      cached.overlayRef === this.overlay
    ) {
      return cached;
    }

    const styledLines: string[] = [];
    const plainLines: string[] = [];
    for (const entry of this.entries) {
      const rendered = this.cachedEntryLines(entry, width);
      styledLines.push(...rendered.styledLines);
      plainLines.push(...rendered.plainLines);
    }
    if (this.transientOutput?.trim()) {
      const transientStyled = [
        ...formatMarkdownForTerminal(this.transientOutput, {
          width: Math.max(20, width - 6),
        }).map((line) => `    ${line}`),
        "",
      ];
      styledLines.push(...transientStyled);
      plainLines.push(...transientStyled.map(stripAnsi));
    }
    if (this.progress) {
      const progressLine = paint.magenta(
        `◯ 正在执行…  ${this.progress.label}  ·  等待 ${progressDuration}`
      );
      styledLines.push(progressLine, "");
      plainLines.push(stripAnsi(progressLine), "");
    }
    if (this.overlay) {
      styledLines.push(...this.overlay);
      plainLines.push(...this.overlay.map(stripAnsi));
    }

    const record: BodyCacheRecord = {
      entriesRevision: this.entriesRevision,
      expandThinking: this.expandThinking,
      expandToolOutput: this.expandToolOutput,
      transientOutput: this.transientOutput,
      progressLabel,
      progressDuration,
      overlayRef: this.overlay,
      styledLines,
      plainLines,
    };
    this.bodyCacheByWidth.set(width, record);
    return record;
  }

  private buildBody(width: number): string[] {
    return this.buildBodyWithPlain(width).styledLines;
  }

  private decorateScrollbar(
    line: string,
    rowIndex: number,
    thumb: ScrollbarThumb | null,
    following: boolean,
  ): string {
    const inThumb = thumb !== null && rowIndex >= thumb.start && rowIndex < thumb.start + thumb.length;
    if (!inThumb) return `${line}  `;
    // A hairline handle. The full block read as a second border.
    const mark = following ? paint.dim("┃") : paint.secondary("┃");
    return `${line} ${mark}`;
  }

  private hitScrollbar(column: number, row: number): boolean {
    const hit = this.scrollbarHit;
    if (!hit) return false;
    return column === hit.column && row >= hit.firstRow && row < hit.firstRow + hit.trackCells;
  }

  private applyScrollbar(row: number): void {
    const hit = this.scrollbarHit;
    if (!hit || hit.trackCells <= 0) return;
    const cell = Math.max(0, Math.min(hit.trackCells - 1, row - hit.firstRow));
    const decision = scrollbarClickToOffset(
      cell,
      hit.trackCells,
      hit.totalLines,
      hit.viewportLines,
    );
    const span = Math.max(0, hit.totalLines - hit.viewportLines);
    const contentOffset = decision.kind === "bottom"
      ? span
      : decision.kind === "offset"
        ? decision.offsetFromTop
        : 0;
    const nextOffset = contentOffsetToScrollOffset(
      contentOffset,
      hit.maxOffset,
      hit.totalLines,
      hit.viewportLines,
    );
    if (nextOffset === this.scrollOffset) return;
    this.scrollOffset = nextOffset;
    this.noteUserScroll();
    this.render(false, false);
  }

  /** A manual scroll parks the viewport. Reaching the bottom follows again. */
  private noteUserScroll(): void {
    this.followTail = this.scrollOffset === 0;
    this.anchoredTop = null;
  }

  private compose(): string[] {
    const width = Math.max(40, this.capabilities.columns);
    const rows = Math.max(12, this.capabilities.rows);
    const header = formatFullscreenHeader(this.chrome, width);
    const uiMode = resolveGrokUiMode(
      this.chrome.sessionMode,
      this.chrome.permissionMode
    );
    const accent = modeAccentHex(uiMode);
    header[0] = header[0]
      .replace(/(Workspace: )(\S+)/, (_match, label, value) => label + paint.primary(value))
      .replace(/(● Ready)/, paint.success("$1"))
      .replace(/(○ Busy)/, paint.warn("$1"));
    header[1] = paint.dim(header[1]);
    const hintText = formatFullscreenFooterHints(
      this.selectionAnchor !== null && this.selectionMoved,
      width
    );
    const hints = fit(hintText, width - 10);
    const clock = this.now().toLocaleTimeString("zh-CN", { hour12: false });
    const footer = fit(hints, width - stringWidth(clock) - 1) + clock;
    const inputWidth = width - 4;
    const promptPrefix = modePromptPrefix(uiMode);
    const prefixWidth = stringWidth(promptPrefix);
    const textWidth = Math.max(1, inputWidth - prefixWidth);
    const wrapped = this.input
      ? wrapFullscreenInput(this.input, textWidth, this.inputCursor)
      : { lines: [this.placeholder], cursorRow: 0, cursorCol: 0 };
    const maxInputLines = Math.max(1, Math.min(8, rows - header.length - 4));
    let windowStart = 0;
    if (wrapped.cursorRow >= maxInputLines) windowStart = wrapped.cursorRow - maxInputLines + 1;
    windowStart = Math.max(0, Math.min(windowStart, Math.max(0, wrapped.lines.length - maxInputLines)));
    const visibleWrapped = wrapped.lines.slice(windowStart, windowStart + maxInputLines);
    const cursorVisibleRow = wrapped.cursorRow - windowStart;
    const continuation = " ".repeat(prefixWidth);
    const inputBody = visibleWrapped.map((line, index) => {
      const prefix = !this.input || windowStart + index === 0 ? promptPrefix : continuation;
      return fg(accent, "│ ") + fit(prefix + line, inputWidth) + fg(accent, " │");
    });
    this.cursorColumn = Math.min(
      this.capabilities.columns - 1,
      3 + prefixWidth + (this.input ? wrapped.cursorCol : 0)
    );
    const hidden = wrapped.lines.length > visibleWrapped.length;
    const inputLabel = hidden
      ? `${windowStart + 1}-${windowStart + visibleWrapped.length}/${wrapped.lines.length}`
      : modeInputTopLabel(uiMode, "");
    let topLabel = inputLabel;
    while (stringWidth(`╭─ ${topLabel} ╮`) > width && topLabel.length > 1) {
      topLabel = topLabel.slice(0, -1);
    }
    const topPrefix = `╭─ ${topLabel} `;
    const topDash = Math.max(1, width - stringWidth(topPrefix) - 1);
    const topBorder = topPrefix + "─".repeat(topDash) + "╮";
    const input = [
      fg(accent, stringWidth(topBorder) > width ? fit(topBorder, width) : topBorder),
      ...inputBody,
      fg(accent, `╰${"─".repeat(width - 2)}╯`),
      paint.dim(footer),
    ];
    const contentHeight = Math.max(0, rows - header.length - input.length);
    const feedbackLineCount = this.selectionFeedback ? 1 : 0;
    const bottomContentHeight = Math.max(1, contentHeight - feedbackLineCount);
    const narrowedWidth = width - 2;
    const cachedNarrow = width >= 44 ? this.bodyCacheByWidth.get(narrowedWidth) : undefined;
    let bodyRecord: { styledLines: string[]; plainLines: string[] };
    let showScrollbar = false;
    if (
      cachedNarrow &&
      cachedNarrow.entriesRevision === this.entriesRevision &&
      cachedNarrow.expandThinking === this.expandThinking &&
      cachedNarrow.expandToolOutput === this.expandToolOutput &&
      cachedNarrow.transientOutput === this.transientOutput &&
      cachedNarrow.overlayRef === this.overlay &&
      cachedNarrow.styledLines.length > bottomContentHeight
    ) {
      // 滚动条已激活用窄宽度缓存直接命中，避免先算 width 再算 width - 2
      bodyRecord = this.buildBodyWithPlain(narrowedWidth);
      showScrollbar = true;
    } else {
      bodyRecord = this.buildBodyWithPlain(width);
      showScrollbar = bodyRecord.styledLines.length > bottomContentHeight && width >= 44;
      if (showScrollbar) {
        bodyRecord = this.buildBodyWithPlain(narrowedWidth);
      }
    }
    const contentWidth = showScrollbar ? narrowedWidth : width;
    const body = bodyRecord.styledLines;
    this.logicalBodyPlain = bodyRecord.plainLines;
    const maxOffset =
      body.length > bottomContentHeight
        ? Math.max(0, body.length - Math.max(1, bottomContentHeight - 1))
        : 0;
    this.maxScrollOffset = maxOffset;
    if (this.followTail) {
      this.scrollOffset = 0;
      this.anchoredTop = null;
    } else if (this.anchoredTop !== null) {
      const parkedHeight = Math.max(1, bottomContentHeight - 1);
      const next = body.length - (this.anchoredTop + parkedHeight);
      this.scrollOffset = Math.max(0, Math.min(maxOffset, next));
    }
    const offset = Math.min(maxOffset, this.scrollOffset);
    this.scrollOffset = offset;
    if (offset === 0) {
      this.followTail = true;
      this.anchoredTop = null;
    } else {
      const parkedHeight = Math.max(1, bottomContentHeight - 1);
      const end = body.length - offset;
      this.anchoredTop = Math.max(0, end - parkedHeight);
      this.followTail = false;
    }
    const end = body.length - offset;
    const visibleHeight = Math.max(
      1,
      bottomContentHeight - (offset > 0 ? 1 : 0)
    );
    const visibleStart = Math.max(0, end - visibleHeight);
    const visible = body
      .slice(visibleStart, end)
      .map((line, index) => {
        const fitted = fit(line, contentWidth);
        const selected = this.selectedCellsForLine(visibleStart + index);
        return selected
          ? highlightVisibleCells(fitted, selected[0], selected[1])
          : fitted;
      });
    const scrollStatus = [
      ...(offset > 0
        ? [fit(paint.warn(`↑ 已离开底部 · ${offset} 行`), contentWidth)]
        : []),
      ...(this.selectionFeedback
        ? [fit(paint.success(`✓ ${this.selectionFeedback}`), contentWidth)]
        : []),
    ];
    const padded = [
      ...scrollStatus,
      ...visible,
      ...Array(Math.max(0, contentHeight - scrollStatus.length - visible.length)).fill(""),
    ].map((line) => stringWidth(stripAnsi(line)) === contentWidth ? line : fit(line, contentWidth));
    const thumb = showScrollbar
      ? scrollbarThumb(
          padded.length,
          body.length,
          bottomContentHeight,
          scrollOffsetToContentOffset(offset, maxOffset, body.length, bottomContentHeight),
        )
      : null;
    const railed = showScrollbar
      ? padded.map((line, index) => this.decorateScrollbar(line, index, thumb, offset === 0))
      : padded;
    this.scrollbarHit = showScrollbar
      ? {
          column: width,
          firstRow: header.length + 1,
          trackCells: padded.length,
          totalLines: body.length,
          viewportLines: bottomContentHeight,
          maxOffset,
        }
      : null;
    this.screenBodyRows.clear();
    const firstBodyRow = header.length + scrollStatus.length + 1;
    for (let index = 0; index < visible.length; index++) {
      this.screenBodyRows.set(firstBodyRow + index, visibleStart + index);
    }
    this.visibleBodyFirstRow = firstBodyRow;
    this.visibleBodyLastRow = Math.max(firstBodyRow, firstBodyRow + visible.length - 1);
    const lines = [...header, ...railed, ...input].slice(0, rows);
    this.cursorRow = Math.max(1, lines.length - input.length + 2 + cursorVisibleRow);
    if (this.capabilities.colorMode === "none") return lines.map(stripAnsi);
    if (this.capabilities.colorMode === "ansi256") return lines.map(toAnsi256);
    return lines;
  }

  private render(force = false, refreshChrome = false): void {
    if (!this.active) return;
    const lines = this.compose();
    const fixedRows = new Set([
      0,
      1,
      Math.max(0, lines.length - 4),
      Math.max(0, lines.length - 3),
      Math.max(0, lines.length - 2),
      Math.max(0, lines.length - 1),
    ]);
    let frameBuffer = "";
    for (let index = 0; index < lines.length; index++) {
      if (
        !force &&
        this.previous[index] === lines[index] &&
        (!refreshChrome || !fixedRows.has(index))
      ) continue;
      frameBuffer += `\x1b[${index + 1};1H\x1b[2K${lines[index]}`;
    }
    this.previous = lines;
    frameBuffer += `\x1b[${Math.max(1, this.cursorRow)};${Math.max(3, this.cursorColumn)}H\x1b[?25h`;
    this.writeRaw(frameBuffer);
  }
}
