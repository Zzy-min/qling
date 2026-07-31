import stringWidth from "string-width";
import { getPackageVersion } from "../package-version.js";
import { formatMarkdownForTerminal } from "./markdown.js";
import {
  modeAccentHex,
  modeInputTopLabel,
  modePromptPrefix,
  resolveGrokUiMode,
} from "./mode-chrome.js";
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
  | { kind: "tool"; tool: string; command: string; status: "running" | "success" | "error"; durationMs?: number; output?: string };

export interface FullscreenMouseEvent {
  kind: "down" | "drag" | "up";
  column: number;
  row: number;
}

interface SelectionPoint {
  line: number;
  column: number;
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
  private placeholder = "输入任务，/help 查看命令";
  private overlay: string[] | null = null;
  private expandToolOutput = false;
  private progress: { label: string; elapsedMs: number } | null = null;
  private transientOutput: string | null = null;
  private previous: string[] = [];
  private scrollOffset = 0;
  private maxScrollOffset = 0;
  private active = false;
  private selectionAnchor: SelectionPoint | null = null;
  private selectionHead: SelectionPoint | null = null;
  private selectionDragging = false;
  private selectionMoved = false;
  private selectionFeedback: string | null = null;
  private logicalBodyPlain: string[] = [];
  private screenBodyRows = new Map<number, number>();
  private visibleBodyFirstRow = 0;
  private visibleBodyLastRow = 0;
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

  streamAssistant(text: string): void {
    const previous = this.entries.at(-1);
    if (previous?.kind === "assistant" && previous.streaming) {
      this.entries[this.entries.length - 1] = { kind: "assistant", text, streaming: true };
      this.scrollOffset = 0;
      this.render();
      return;
    }
    this.append({ kind: "assistant", text, streaming: true });
  }

  completeAssistant(text: string): void {
    const previous = this.entries.at(-1);
    if (previous?.kind === "assistant" && previous.streaming) {
      this.entries[this.entries.length - 1] = { kind: "assistant", text };
      this.scrollOffset = 0;
      this.render();
      return;
    }
    this.appendAssistant(text);
  }
  appendTool(tool: string, command: string, status: "running" | "success" | "error", durationMs?: number, output?: string): void {
    const previous = this.entries.at(-1);
    if (previous?.kind === "tool" && previous.tool === tool && previous.command === command && previous.status === "running") {
      this.entries[this.entries.length - 1] = { kind: "tool", tool, command, status, durationMs, output };
      this.render();
      return;
    }
    this.append({ kind: "tool", tool, command, status, durationMs, output });
  }

  clearEntries(): void {
    this.entries = [];
    this.scrollOffset = 0;
    this.clearSelection();
    this.render();
  }

  clearConversationView(placeholder = "输入任务，/help 查看命令"): void {
    this.entries = [];
    this.transientOutput = null;
    this.progress = null;
    this.overlay = null;
    this.input = "";
    this.inputCursor = 0;
    this.placeholder = placeholder;
    this.scrollOffset = 0;
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
    this.render(false, false);
  }

  scrollPages(delta: number): void {
    const page = Math.max(4, this.capabilities.rows - 8);
    this.scrollLines(delta * page);
  }

  scrollEnd(): void {
    this.scrollOffset = 0;
    this.render();
  }

  handleMouse(event: FullscreenMouseEvent): boolean {
    if (event.kind === "down") {
      const point = this.selectionPointAt(event.column, event.row);
      this.selectionAnchor = point;
      this.selectionHead = point;
      this.selectionDragging = point !== null;
      this.selectionMoved = false;
      this.selectionFeedback = null;
      this.render();
      return point !== null;
    }
    if (!this.selectionDragging || !this.selectionAnchor) return false;

    if (event.kind === "drag") {
      if (event.row <= this.visibleBodyFirstRow) this.scrollLines(2);
      else if (event.row >= this.visibleBodyLastRow) this.scrollLines(-2);
    }
    const point = this.selectionPointAt(event.column, event.row, true);
    if (point) {
      this.selectionHead = point;
      this.selectionMoved =
        this.selectionMoved ||
        compareSelectionPoint(this.selectionAnchor, point) !== 0;
    }
    if (event.kind === "up") {
      this.selectionDragging = false;
      if (!this.selectionMoved) {
        this.selectionAnchor = null;
        this.selectionHead = null;
        this.render();
        return false;
      }
      const copied = this.copySelection();
      this.render();
      return copied;
    }
    this.render();
    return true;
  }

  getSelectedText(): string | null {
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

  copySelection(): boolean {
    const text = this.getSelectedText();
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
    }
    this.scrollOffset = 0;
    this.render();
  }

  private clearSelection(): void {
    this.selectionAnchor = null;
    this.selectionHead = null;
    this.selectionDragging = false;
    this.selectionMoved = false;
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
    const value = this.input || this.placeholder;
    const inputWidth = width - 4;
    const cursorPrefix = this.input.slice(0, this.inputCursor);
    const cursorPrefixWidth = stringWidth(cursorPrefix);
    const contentWidth = Math.max(1, inputWidth - 2);
    let visibleValue = value;
    let cursorInValue = cursorPrefixWidth;
    if (this.input && cursorPrefixWidth > contentWidth - 1) {
      let visiblePrefix = cursorPrefix;
      while (visiblePrefix && stringWidth(visiblePrefix) > contentWidth - 2) {
        visiblePrefix = visiblePrefix.slice(1);
      }
      visibleValue = `‹${visiblePrefix}${this.input.slice(this.inputCursor)}`;
      cursorInValue = 1 + stringWidth(visiblePrefix);
    }
    const promptPrefix = modePromptPrefix(uiMode);
    this.cursorColumn = Math.min(
      this.capabilities.columns - 2,
      3 + stringWidth(promptPrefix) + (this.input ? cursorInValue : 0)
    );
    const inputLabel = modeInputTopLabel(uiMode, "");
    const topPrefix = `╭─ ${inputLabel} `;
    const topBorder =
      topPrefix +
      "─".repeat(Math.max(1, width - stringWidth(topPrefix) - 1)) +
      "╮";
    const input = [
      fg(accent, topBorder),
      fg(accent, "│ ") + fit(`${promptPrefix}${visibleValue}`, inputWidth) + fg(accent, " │"),
      fg(accent, `╰${"─".repeat(width - 2)}╯`),
      paint.dim(footer),
    ];
    const contentHeight = Math.max(1, rows - header.length - input.length);
    let body = this.entries.flatMap((entry) => this.entryLines(entry, width));
    if (this.transientOutput?.trim()) {
      body.push(
        ...formatMarkdownForTerminal(this.transientOutput, {
          width: Math.max(20, width - 6),
        }).map((line) => `    ${line}`),
        ""
      );
    }
    if (this.progress) {
      body.push(
        paint.magenta(
          `◯ 正在执行…  ${this.progress.label}  ·  等待 ${duration(this.progress.elapsedMs)}`
        ),
        ""
      );
    }
    if (this.overlay) body = [...body, ...this.overlay];
    this.logicalBodyPlain = body.map(stripAnsi);
    const feedbackLineCount = this.selectionFeedback ? 1 : 0;
    const bottomContentHeight = Math.max(1, contentHeight - feedbackLineCount);
    const maxOffset =
      body.length > bottomContentHeight
        ? Math.max(0, body.length - Math.max(1, bottomContentHeight - 1))
        : 0;
    this.maxScrollOffset = maxOffset;
    const offset = Math.min(maxOffset, this.scrollOffset);
    this.scrollOffset = offset;
    const end = body.length - offset;
    const visibleHeight = Math.max(
      1,
      bottomContentHeight - (offset > 0 ? 1 : 0)
    );
    const visibleStart = Math.max(0, end - visibleHeight);
    const visible = body
      .slice(visibleStart, end)
      .map((line, index) => {
        const fitted = fit(line, width);
        const selected = this.selectedCellsForLine(visibleStart + index);
        return selected
          ? highlightVisibleCells(fitted, selected[0], selected[1])
          : fitted;
      });
    const scrollStatus = [
      ...(offset > 0
        ? [fit(paint.warn(`↑ 已离开底部 · ${offset} 行`), width)]
        : []),
      ...(this.selectionFeedback
        ? [fit(paint.success(`✓ ${this.selectionFeedback}`), width)]
        : []),
    ];
    const padded = [
      ...scrollStatus,
      ...visible,
      ...Array(Math.max(0, contentHeight - scrollStatus.length - visible.length)).fill(""),
    ].map((line) => stringWidth(stripAnsi(line)) === width ? line : fit(line, width));
    this.screenBodyRows.clear();
    const firstBodyRow = header.length + scrollStatus.length + 1;
    for (let index = 0; index < visible.length; index++) {
      this.screenBodyRows.set(firstBodyRow + index, visibleStart + index);
    }
    this.visibleBodyFirstRow = firstBodyRow;
    this.visibleBodyLastRow = Math.max(firstBodyRow, firstBodyRow + visible.length - 1);
    const lines = [...header, ...padded, ...input].slice(0, rows);
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
    for (let index = 0; index < lines.length; index++) {
      if (
        !force &&
        this.previous[index] === lines[index] &&
        (!refreshChrome || !fixedRows.has(index))
      ) continue;
      this.writeRaw(`\x1b[${index + 1};1H\x1b[2K${lines[index]}`);
    }
    this.previous = lines;
    const inputRow = Math.max(1, lines.length - 2);
    this.writeRaw(`\x1b[${inputRow};${Math.max(3, this.cursorColumn)}H\x1b[?25h`);
  }
}
