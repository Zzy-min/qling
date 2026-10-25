const graphemeSegmenter =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

/**
 * 對標 grok-build `xai-ratatui-textarea/src/textarea.rs`:
 * 排除 DEL (\x7f)、BS (\x08) 以及除 \n / \t 之外的 C0/C1 控制字符，避免作為不可見垃圾插入輸入緩衝區。
 */
export function isInsertableInputChar(ch: string): boolean {
  if (!ch) return false;
  if (ch === "\n" || ch === "\t") return true;
  const code = ch.codePointAt(0);
  if (code === undefined) return false;
  if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) {
    return false;
  }
  return true;
}

/**
 * 對標 grok-build `prev_atomic_boundary`: 按完整字素簇 / Code Point 向左退回一個原子字符邊界。
 */
export function prevAtomicBoundary(value: string, index: number): number {
  const clamped = Math.max(0, Math.min(index, value.length));
  if (clamped <= 0) return 0;
  if (graphemeSegmenter) {
    let prev = 0;
    for (const seg of graphemeSegmenter.segment(value)) {
      if (seg.index >= clamped) break;
      prev = seg.index;
    }
    return prev;
  }
  const low = value.charCodeAt(clamped - 1);
  if (low >= 0xdc00 && low <= 0xdfff && clamped >= 2) {
    const high = value.charCodeAt(clamped - 2);
    if (high >= 0xd800 && high <= 0xdbff) {
      return clamped - 2;
    }
  }
  return clamped - 1;
}

/**
 * 對標 grok-build `next_atomic_boundary`: 按完整字素簇 / Code Point 向右前進一個原子字符邊界。
 */
export function nextAtomicBoundary(value: string, index: number): number {
  const clamped = Math.max(0, Math.min(index, value.length));
  if (clamped >= value.length) return value.length;
  if (graphemeSegmenter) {
    for (const seg of graphemeSegmenter.segment(value)) {
      const segEnd = seg.index + seg.segment.length;
      if (segEnd > clamped) {
        return segEnd;
      }
    }
    return value.length;
  }
  const code = value.codePointAt(clamped);
  return Math.min(value.length, clamped + (code !== undefined && code > 0xffff ? 2 : 1));
}

export class InputBuffer {
  value = "";
  cursorPos = 0;
  private history: string[] = [];
  private historyIdx = -1;
  private historyDraft: string | null = null;
  private historyDraftCursorPos = 0;

  constructor(initialHistory: string[] = []) {
    this.setHistory(initialHistory);
  }

  setHistory(entries: string[]): void {
    this.history = entries.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim());
    this.historyIdx = this.history.length;
    this.clearHistoryDraft();
  }

  getHistory(): string[] {
    return [...this.history];
  }

  insertChar(ch: string): void {
    const filtered = Array.from(ch).filter(isInsertableInputChar).join("");
    if (!filtered) return;
    // 钳制：防止异常 cursorPos 导致插入到「字中间」且显示偏移
    if (this.cursorPos < 0) this.cursorPos = 0;
    if (this.cursorPos > this.value.length) this.cursorPos = this.value.length;
    this.value = this.value.slice(0, this.cursorPos) + filtered + this.value.slice(this.cursorPos);
    this.cursorPos += filtered.length;
    if (this.cursorPos > this.value.length) this.cursorPos = this.value.length;
  }

  insertNewline(): void {
    this.insertChar("\n");
  }

  backspace(): void {
    if (this.cursorPos <= 0) return;
    const target = prevAtomicBoundary(this.value, this.cursorPos);
    this.value = this.value.slice(0, target) + this.value.slice(this.cursorPos);
    this.cursorPos = target;
  }

  moveLeft(): void {
    if (this.cursorPos > 0) {
      this.cursorPos = prevAtomicBoundary(this.value, this.cursorPos);
    }
  }

  moveRight(): void {
    if (this.cursorPos < this.value.length) {
      this.cursorPos = nextAtomicBoundary(this.value, this.cursorPos);
    }
  }

  moveWordLeft(): void {
    if (this.cursorPos <= 0) return;

    let nextPos = this.cursorPos;
    while (nextPos > 0 && /\s/.test(this.value[nextPos - 1] ?? "")) {
      nextPos--;
    }
    while (nextPos > 0 && !/\s/.test(this.value[nextPos - 1] ?? "")) {
      nextPos--;
    }

    this.cursorPos = nextPos;
  }

  moveWordRight(): void {
    if (this.cursorPos >= this.value.length) return;

    let nextPos = this.cursorPos;
    while (nextPos < this.value.length && !/\s/.test(this.value[nextPos] ?? "")) {
      nextPos++;
    }
    while (nextPos < this.value.length && /\s/.test(this.value[nextPos] ?? "")) {
      nextPos++;
    }

    this.cursorPos = nextPos;
  }

  moveLineUp(): void {
    const position = this.getLinePosition();
    if (position.lineIndex <= 0) return;

    const targetLine = position.lines[position.lineIndex - 1] ?? "";
    const targetColumn = Math.min(position.column, targetLine.length);
    this.cursorPos = position.lineStartOffsets[position.lineIndex - 1] + targetColumn;
  }

  moveLineDown(): void {
    const position = this.getLinePosition();
    if (position.lineIndex >= position.lines.length - 1) return;

    const targetLine = position.lines[position.lineIndex + 1] ?? "";
    const targetColumn = Math.min(position.column, targetLine.length);
    this.cursorPos = position.lineStartOffsets[position.lineIndex + 1] + targetColumn;
  }

  moveStart(): void {
    this.cursorPos = 0;
  }

  moveEnd(): void {
    this.cursorPos = this.value.length;
  }

  deleteBeforeCursor(): void {
    if (this.cursorPos <= 0) return;
    this.value = this.value.slice(this.cursorPos);
    this.cursorPos = 0;
  }

  deleteAfterCursor(): void {
    if (this.cursorPos >= this.value.length) return;
    this.value = this.value.slice(0, this.cursorPos);
  }

  deleteAfterCursorChar(): void {
    if (this.cursorPos >= this.value.length) return;
    const target = nextAtomicBoundary(this.value, this.cursorPos);
    this.value = this.value.slice(0, this.cursorPos) + this.value.slice(target);
  }

  deleteWordBeforeCursor(): void {
    if (this.cursorPos <= 0) return;

    let start = this.cursorPos;
    while (start > 0 && /\s/.test(this.value[start - 1] ?? "")) {
      start--;
    }
    while (start > 0 && !/\s/.test(this.value[start - 1] ?? "")) {
      start--;
    }

    this.value = this.value.slice(0, start) + this.value.slice(this.cursorPos);
    this.cursorPos = start;
  }

  deleteWordAfterCursor(): void {
    if (this.cursorPos >= this.value.length) return;

    let start = this.cursorPos;
    while (start < this.value.length && /\s/.test(this.value[start] ?? "")) {
      start++;
    }

    let end = start;
    while (end < this.value.length && /\s/.test(this.value[end] ?? "")) {
      end++;
    }
    while (end < this.value.length && !/\s/.test(this.value[end] ?? "")) {
      end++;
    }

    this.value = this.value.slice(0, start) + this.value.slice(end);
  }

  historyUp(): void {
    if (this.historyIdx > 0) {
      this.saveHistoryDraft();
      this.historyIdx--;
      this.value = this.history[this.historyIdx] ?? "";
      this.cursorPos = this.value.length;
    }
  }

  historyDown(): void {
    if (this.historyIdx < this.history.length - 1) {
      this.historyIdx++;
      this.value = this.history[this.historyIdx] ?? "";
    } else {
      this.historyIdx = this.history.length;
      this.restoreHistoryDraft();
      return;
    }
    this.cursorPos = this.value.length;
  }

  searchHistory(): boolean {
    const query = this.value.trim();
    if (!query) {
      const before = this.value;
      const beforeIdx = this.historyIdx;
      this.historyUp();
      return this.value !== before || this.historyIdx !== beforeIdx;
    }

    for (let i = this.history.length - 1; i >= 0; i--) {
      const entry = this.history[i] ?? "";
      if (entry.includes(query)) {
        this.saveHistoryDraft();
        this.historyIdx = i;
        this.value = entry;
        this.cursorPos = entry.length;
        return true;
      }
    }

    return false;
  }

  clear(): void {
    this.value = "";
    this.cursorPos = 0;
    this.historyIdx = this.history.length;
    this.clearHistoryDraft();
  }

  submit(): string | null {
    const cmd = this.value.trim();
    if (!cmd) return null;
    this.history = [...this.history.filter((entry) => entry !== cmd), cmd];
    this.historyIdx = this.history.length;
    this.clear();
    return cmd;
  }

  private saveHistoryDraft(): void {
    if (this.historyIdx !== this.history.length || this.historyDraft !== null) return;
    this.historyDraft = this.value;
    this.historyDraftCursorPos = this.cursorPos;
  }

  private restoreHistoryDraft(): void {
    this.value = this.historyDraft ?? "";
    this.cursorPos = this.historyDraft === null ? this.value.length : this.historyDraftCursorPos;
    this.clearHistoryDraft();
  }

  private clearHistoryDraft(): void {
    this.historyDraft = null;
    this.historyDraftCursorPos = 0;
  }

  private getLinePosition(): {
    lines: string[];
    lineStartOffsets: number[];
    lineIndex: number;
    column: number;
  } {
    const lines = this.value.split("\n");
    const lineStartOffsets: number[] = [];
    let offset = 0;

    for (const line of lines) {
      lineStartOffsets.push(offset);
      offset += line.length + 1;
    }

    let lineIndex = 0;
    for (let i = 0; i < lineStartOffsets.length; i++) {
      const start = lineStartOffsets[i];
      const line = lines[i] ?? "";
      const end = start + line.length;
      if (this.cursorPos <= end || i === lineStartOffsets.length - 1) {
        lineIndex = i;
        break;
      }
    }

    return {
      lines,
      lineStartOffsets,
      lineIndex,
      column: this.cursorPos - lineStartOffsets[lineIndex],
    };
  }
}
