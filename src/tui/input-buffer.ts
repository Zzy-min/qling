export class InputBuffer {
  value = "";
  cursorPos = 0;
  private history: string[] = [];
  private historyIdx = -1;

  constructor(initialHistory: string[] = []) {
    this.setHistory(initialHistory);
  }

  setHistory(entries: string[]): void {
    this.history = entries.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim());
    this.historyIdx = this.history.length;
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

  historyUp(): void {
    if (this.historyIdx > 0) {
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
      this.value = "";
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
  }

  submit(): string | null {
    const cmd = this.value.trim();
    if (!cmd) return null;
    this.history = [...this.history.filter((entry) => entry !== cmd), cmd];
    this.historyIdx = this.history.length;
    this.clear();
    return cmd;
  }
}
