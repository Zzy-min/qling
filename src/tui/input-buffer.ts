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
    this.value = this.value.slice(0, this.cursorPos) + ch + this.value.slice(this.cursorPos);
    this.cursorPos += ch.length;
  }

  insertNewline(): void {
    this.insertChar("\n");
  }

  backspace(): void {
    if (this.cursorPos <= 0) return;
    this.value = this.value.slice(0, this.cursorPos - 1) + this.value.slice(this.cursorPos);
    this.cursorPos--;
  }

  moveLeft(): void {
    if (this.cursorPos > 0) {
      this.cursorPos--;
    }
  }

  moveRight(): void {
    if (this.cursorPos < this.value.length) {
      this.cursorPos++;
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
}
