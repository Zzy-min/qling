// ============================================================
// repl-tui.ts - TUI REPL 入口
// 负责：键盘事件处理 + TUIRepl 控制
// ============================================================

import { TUIRenderer } from "./renderer.js";

export class TUIRepl {
  private renderer: TUIRenderer;
  private input: string = "";
  private cursorPos: number = 0;
  private history: string[] = [];
  private historyIdx: number = -1;
  private running: boolean = false;

  constructor() {
    this.renderer = new TUIRenderer();
  }

  // 处理键盘输入
  private handleKey(key: string, raw: Buffer): void {
    if (key === "Enter") {
      const cmd = this.input.trim();
      if (cmd) {
        this.history.push(cmd);
        this.historyIdx = this.history.length;
        this.executeCommand(cmd);
      }
      this.input = "";
      this.cursorPos = 0;
      this.renderer.refresh();
      return;
    }

    if (key === "Ctrl+C") {
      this.input = "";
      this.cursorPos = 0;
      this.renderer.refresh();
      return;
    }

    if (key === "ArrowUp") {
      if (this.historyIdx > 0) {
        this.historyIdx--;
        this.input = this.history[this.historyIdx] ?? "";
        this.cursorPos = this.input.length;
      }
      this.renderer.refresh();
      return;
    }

    if (key === "ArrowDown") {
      if (this.historyIdx < this.history.length - 1) {
        this.historyIdx++;
        this.input = this.history[this.historyIdx] ?? "";
      } else {
        this.historyIdx = this.history.length;
        this.input = "";
      }
      this.cursorPos = this.input.length;
      this.renderer.refresh();
      return;
    }

    if (key === "Backspace") {
      if (this.cursorPos > 0) {
        this.input = this.input.slice(0, this.cursorPos - 1) + this.input.slice(this.cursorPos);
        this.cursorPos--;
      }
      this.renderer.refresh();
      return;
    }

    if (key === "Delete") {
      if (this.cursorPos < this.input.length) {
        this.input = this.input.slice(0, this.cursorPos) + this.input.slice(this.cursorPos + 1);
      }
      this.renderer.refresh();
      return;
    }

    if (key === "ArrowLeft") {
      if (this.cursorPos > 0) this.cursorPos--;
      this.renderer.refresh();
      return;
    }

    if (key === "ArrowRight") {
      if (this.cursorPos < this.input.length) this.cursorPos++;
      this.renderer.refresh();
      return;
    }

    // 普通可见字符
    if (raw && raw.length === 1) {
      const ch = raw.toString("utf8");
      this.input = this.input.slice(0, this.cursorPos) + ch + this.input.slice(this.cursorPos);
      this.cursorPos++;
      this.renderer.refresh();
    }
  }

  private executeCommand(cmd: string): void {
    if (cmd === "/quit" || cmd === "/exit") {
      this.running = false;
      return;
    }
    if (cmd === "/clear") {
      this.renderer.refresh();
      return;
    }
    // 其他命令暂不支持
  }

  // 启动 REPL
  start(): void {
    this.running = true;
    this.renderer.start(this);

    // 设置 raw mode
    try {
      const tty = require("tty");
      tty.setRawMode(true);
    } catch (e) {
      // not available in non-tty
    }

    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    const keyMap: { [key: string]: string } = {
      "\r": "Enter",
      "\n": "Enter",
      "\x03": "Ctrl+C",
      "\x7f": "Backspace",
      "\x1b[A": "ArrowUp",
      "\x1b[B": "ArrowDown",
      "\x1b[C": "ArrowRight",
      "\x1b[D": "ArrowLeft",
      "\x1b[3~": "Delete",
    };

    let partial = "";

    process.stdin.on("data", (chunk: string) => {
      for (const ch of chunk) {
        const seq = partial + ch;
        if (keyMap[seq]) {
          this.handleKey(keyMap[seq], Buffer.from(ch));
          partial = "";
        } else if (seq.startsWith("\x1b[") && !seq.includes("~") && seq.length > 4) {
          partial = "";
        } else if (seq.startsWith("\x1b[")) {
          partial = seq;
        } else {
          partial = "";
          this.handleKey(ch, Buffer.from(ch));
        }
      }
    });

    // 窗口大小变化
    if (process.stdout.isTTY) {
      const fn = () => {
        require("tty").setRawMode && this.renderer.resize(process.stdout.columns!, process.stdout.rows!);
      };
      process.stdout.on("resize", fn);
    }
  }
}
