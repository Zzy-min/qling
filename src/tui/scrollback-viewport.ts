import { visibleWidth } from "./shell.js";

export type ScrollbackBlockKind = "user" | "assistant" | "tool";

export interface ScrollbackBlock {
  kind: ScrollbackBlockKind;
  text: string;
  label?: string;
}

export interface ScrollbackTurn {
  id: number;
  preview: string;
  blocks: ScrollbackBlock[];
}

export interface ScrollbackViewportSnapshot {
  turnIndex: number;
  turnCount: number;
  page: number;
  pageCount: number;
  lineOffset: number;
  totalLines: number;
  lines: string[];
}

const DEFAULT_MAX_TURNS = 40;
const DEFAULT_MAX_BLOCK_BYTES = 20 * 1024;

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

function limitUtf8(value: string, maxBytes: number): string {
  const source = String(value ?? "");
  if (Buffer.byteLength(source, "utf8") <= maxBytes) return source;
  let output = "";
  let used = 0;
  for (const char of source) {
    const size = Buffer.byteLength(char, "utf8");
    if (used + size > Math.max(0, maxBytes - 3)) break;
    output += char;
    used += size;
  }
  return output + "…";
}

export function wrapViewportText(value: string, width: number): string[] {
  const maxWidth = Math.max(1, Math.floor(width));
  const result: string[] = [];
  for (const logical of stripAnsi(String(value ?? "")).replace(/\r\n?/g, "\n").split("\n")) {
    if (!logical) {
      result.push("");
      continue;
    }
    let line = "";
    let lineWidth = 0;
    for (const char of logical) {
      const charWidth = Math.max(0, visibleWidth(char));
      if (line && lineWidth + charWidth > maxWidth) {
        result.push(line);
        line = "";
        lineWidth = 0;
      }
      line += char;
      lineWidth += charWidth;
    }
    result.push(line);
  }
  return result.length > 0 ? result : [""];
}

function labelFor(block: ScrollbackBlock): string {
  if (block.kind === "user") return "你";
  if (block.kind === "assistant") return "轻灵";
  return block.label?.trim() ? `工具 ${block.label.trim()}` : "工具";
}

function flattenTurn(turn: ScrollbackTurn, width: number): string[] {
  const contentWidth = Math.max(12, width - 4);
  const lines: string[] = [];
  for (const block of turn.blocks) {
    if (!block.text.trim()) continue;
    if (lines.length > 0) lines.push("");
    lines.push(`【${labelFor(block)}】`);
    lines.push(...wrapViewportText(block.text, contentWidth));
  }
  return lines.length > 0 ? lines : ["(该轮暂无可显示内容)"];
}

export class ScrollbackViewport {
  private turns: ScrollbackTurn[] = [];
  private selectedIndex = -1;
  private lineOffset = 0;
  private readonly maxTurns: number;
  private readonly maxBlockBytes: number;
  private nextId = 1;

  constructor(options: { maxTurns?: number; maxBlockBytes?: number } = {}) {
    this.maxTurns = Math.max(1, Math.floor(options.maxTurns ?? DEFAULT_MAX_TURNS));
    this.maxBlockBytes = Math.max(256, Math.floor(options.maxBlockBytes ?? DEFAULT_MAX_BLOCK_BYTES));
  }

  clear(): void {
    this.turns = [];
    this.selectedIndex = -1;
    this.lineOffset = 0;
    this.nextId = 1;
  }

  startUserTurn(text: string): void {
    const safe = limitUtf8(text, this.maxBlockBytes);
    const preview = safe.replace(/\s+/g, " ").trim().slice(0, 64) || "(空)";
    this.turns.push({
      id: this.nextId++,
      preview,
      blocks: [{ kind: "user", text: safe }],
    });
    if (this.turns.length > this.maxTurns) this.turns.shift();
    this.selectedIndex = this.turns.length - 1;
    this.lineOffset = Number.MAX_SAFE_INTEGER;
  }

  appendAssistant(text: string): boolean {
    return this.appendBlock({ kind: "assistant", text });
  }

  appendTool(label: string, text: string): boolean {
    return this.appendBlock({ kind: "tool", label, text });
  }

  private appendBlock(block: ScrollbackBlock): boolean {
    const turn = this.turns.at(-1);
    if (!turn) return false;
    const safe = limitUtf8(block.text, this.maxBlockBytes);
    if (!safe.trim()) return false;
    turn.blocks.push({ ...block, text: safe });
    if (this.selectedIndex === this.turns.length - 1) {
      this.lineOffset = Number.MAX_SAFE_INTEGER;
    }
    return true;
  }

  getTurnCount(): number {
    return this.turns.length;
  }

  getSelectedTurnIndex(): number {
    return this.selectedIndex;
  }

  getTurnPreview(index: number): string | null {
    return this.turns[index]?.preview ?? null;
  }

  selectTurn(index: number, position: "start" | "tail" = "start"): number {
    if (this.turns.length === 0) {
      this.selectedIndex = -1;
      this.lineOffset = 0;
      return -1;
    }
    this.selectedIndex = Math.max(0, Math.min(Math.floor(index), this.turns.length - 1));
    this.lineOffset = position === "tail" ? Number.MAX_SAFE_INTEGER : 0;
    return this.selectedIndex;
  }

  moveTurn(delta: number): number {
    if (this.turns.length === 0) return this.selectTurn(-1);
    const current = this.selectedIndex < 0 ? this.turns.length - 1 : this.selectedIndex;
    return this.selectTurn(current + Math.trunc(delta), "start");
  }

  scrollPage(delta: number, width: number, height: number): ScrollbackViewportSnapshot {
    const safeHeight = Math.max(1, Math.floor(height));
    const all = this.currentLines(width);
    const maxOffset = Math.max(0, all.length - safeHeight);
    const current = Math.min(this.lineOffset, maxOffset);
    this.lineOffset = Math.max(0, Math.min(maxOffset, current + Math.trunc(delta) * safeHeight));
    return this.snapshot(width, safeHeight);
  }

  snapshot(width: number, height: number): ScrollbackViewportSnapshot {
    const safeHeight = Math.max(1, Math.floor(height));
    const all = this.currentLines(width);
    const maxOffset = Math.max(0, all.length - safeHeight);
    this.lineOffset = Math.max(0, Math.min(this.lineOffset, maxOffset));
    const pageCount = Math.max(1, Math.ceil(all.length / safeHeight));
    const page = Math.min(
      pageCount,
      Math.max(1, Math.ceil((this.lineOffset + safeHeight) / safeHeight))
    );
    return {
      turnIndex: this.selectedIndex,
      turnCount: this.turns.length,
      page,
      pageCount,
      lineOffset: this.lineOffset,
      totalLines: all.length,
      lines: all.slice(this.lineOffset, this.lineOffset + safeHeight),
    };
  }

  private currentLines(width: number): string[] {
    const turn = this.turns[this.selectedIndex];
    return turn ? flattenTurn(turn, Math.max(20, Math.floor(width))) : ["(尚无用户轮次 — 先发一条消息)"];
  }
}
