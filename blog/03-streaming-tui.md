# 从零搭建轻灵（三）：流式 TUI 终端界面

> 这是「从零搭建轻灵」系列的第3篇。我们用纯 ANSI 转义序列实现 Claude Code 风格的终端界面。

## 为什么不用 Ink/React for CLI？

市面上有 Ink（React for CLI）、Blessed 等成熟的终端 UI 库。但轻灵选择**手写 ANSI**，原因：

1. **零依赖**：不需要 React 运行时，包体积更小
2. **完全控制**：每一行的渲染逻辑都在自己手里
3. **学习价值**：理解终端 UI 的底层原理

## ANSI 转义序列基础

终端 UI 的本质是**控制字符**。核心概念：

```typescript
// 前景色（24-bit 真彩色）
const red = "\x1b[38;2;251;113;133m";
const reset = "\x1b[0m";

console.log(`${red}这是红色文字${reset}`);

// 光标控制
process.stdout.write("\x1b[2J\x1b[H"); // 清屏 + 光标回到左上角
process.stdout.write("\x1b[1A");       // 光标上移一行
process.stdout.write("\x1b[0K");       // 清除当前行
process.stdout.write("\x1b[10G");      // 光标移到第10列
```

## StreamUI 核心设计

轻灵的 TUI 设计原则：

1. **追加式输出**（Append-only）——所有事件追加到终端历史，**从不清屏**
2. **Header 只打印一次**——启动时打印模型、工具数、路径
3. **底部输入栏**——Agent 执行期间输入栏保持可用

### 颜色系统

```typescript
// streaming-tui.ts
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

const F = (color: string, s: string): string =>
  `\x1b[38;2;${rgb(color)}m${s}\x1b[0m`;

const S = {
  p: (s: string) => F(C.p, s),  // 竹青绿
  s: (s: string) => F(C.s, s),  // 青蓝
  d: (s: string) => F(C.d, s),  // 灰色
  g: (s: string) => F(C.g, s),  // 绿色
  r: (s: string) => F(C.r, s),  // 红色
  y: (s: string) => F(C.y, s),  // 黄色
};
```

### Header 打印

```typescript
private printHeader(): void {
  const pathStr = process.cwd().replace(/\\/g, "/");
  const line1 =
    S.p(">_ ") + S.p("轻灵 Agent CLI") + "    " +
    S.s(this.model) + "    " + S.g("online") + "    " +
    S.y("tools") + " " + S.y(String(this.tools));
  const line2 = S.d(pathStr);
  process.stdout.write(line1 + "\n" + line2 + "\n");
}
```

效果：
```
>_ 轻灵 Agent CLI    deepseek-chat    online    tools 11
/mnt/c/Users/Lenovo/projects/qingling
```

### 工具执行渲染

```typescript
// 工具开始执行 → 黄色 ● + 工具名
appendToolStart(tool: string, command: string): void {
  this.currentToolRunning = true;
  const icon = S.y("●"); // 黄色 = running
  const cmdDisplay = trunc(command, 80);
  process.stdout.write("\n" + icon + " " + S.s(tool) + "(" + S.d(cmdDisplay) + ")\n");
}

// 工具执行完成 → 绿色 ● + 耗时 + 输出
appendToolSuccess(tool: string, command: string, output: string, durationMs: number): void {
  // 先擦除 running 状态行
  if (this.currentToolRunning) {
    process.stdout.write("\x1b[1A\r\x1b[0K"); // 上移一行 + 清除
    this.currentToolRunning = false;
  }

  const icon = S.g("●"); // 绿色 = 成功
  const dur = durationMs >= 1000 ? (durationMs / 1000).toFixed(1) + "s" : durationMs + "ms";
  process.stdout.write("\n" + icon + " " + S.s(tool) + "(" + S.d(command) + ")\n");
  process.stdout.write("  " + S.g("└ " + dur) + "\n");

  // 输出折叠（超过12行时）
  if (output.trim()) {
    this.printToolOutput(output, "success");
  }
}
```

效果：
```
● bash(ls -la)
  └ 42ms
  drwxr-xr-x  ...
  -rw-r--r--  ...
  ... +3 lines total  (Ctrl+O to expand)
```

### 输出折叠

长输出自动折叠，只显示前8行和后2行：

```typescript
function collapseLines(lines: string[], maxTop: number, maxBottom: number): CollapsedLines {
  if (lines.length <= maxTop + maxBottom) {
    return { top: lines, bottom: [], hidden: 0 };
  }
  return {
    top: lines.slice(0, maxTop),
    bottom: lines.slice(-maxBottom),
    hidden: lines.length - maxTop - maxBottom,
  };
}
```

### 输入栏

底部输入栏支持光标移动、历史回溯：

```typescript
private setupInput(): void {
  process.stdin.setRawMode(true); // 原始模式，逐字符读取
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  let partial = ""; // 处理多字节转义序列

  this.dataHandler = (chunk: string) => {
    for (const ch of chunk) {
      const seq = partial + ch;
      if (seq === "\r" || seq === "\n") {
        this.handleEnter();
      } else if (seq === "\x03") {
        this.handleCtrlC();       // Ctrl+C
      } else if (seq === "\x7f") {
        this.handleBackspace();   // 退格
      } else if (seq === "\x1b[A") {
        this.handleHistoryUp();   // 上箭头
      } else if (seq === "\x1b[B") {
        this.handleHistoryDown(); // 下箭头
      } else if (seq === "\x1b[C") {
        this.handleRight();       // 右箭头
      } else if (seq === "\x1b[D") {
        this.handleLeft();        // 左箭头
      } else if (ch >= " " || ch === "\t") {
        this.handleChar(ch);      // 普通字符
      }
    }
  };
  process.stdin.on("data", this.dataHandler);
}
```

**关键技术点**：转义序列（如方向键 `\x1b[A`）是多字节的，需要 `partial` 变量缓存未完成的序列。

### 光标同步

```typescript
private syncCursor(): void {
  const col = 2 + this.cursorPos; // 2 = "› " 的宽度
  process.stdout.write("\x1b[" + col + "G"); // 移动到指定列
}
```

## CJK 字符宽度问题

中文字符占2个终端列，但 `String.length` 返回1。必须用 `string-width` 库：

```typescript
import { default as stringWidth } from "string-width";

const sw = (s: string): number => stringWidth(s);

// "你好".length === 2, sw("你好") === 4
// "abc".length === 3, sw("abc") === 3
// "\x1b[31m红\x1b[0m".length === 11, sw("\x1b[31m红\x1b[0m") === 2
```

表格渲染时必须用 `sw()` 计算列宽：

```typescript
function printTable(rows: string[][]): void {
  const colWidths: number[] = new Array(colCount).fill(0);
  for (const row of rows) {
    for (let c = 0; c < colCount; c++) {
      colWidths[c] = Math.max(colWidths[c], sw(row[c] ?? ""));
    }
  }
  // 用 colWidths 计算每行的 padding
}
```

## 桥接：AgentLoop ↔ StreamUI

`StreamingREPL` 负责把 AgentLoop 的事件转发给 StreamUI：

```typescript
// streaming-repl.ts
export class StreamingREPL {
  async start(): Promise<void> {
    const ui = new StreamUI(this.model, this.toolsCount);
    const agent = new AgentLoop(this.config);

    // 监听 Agent 事件 → 渲染到 TUI
    agent.on("tool_start", (name, args) => {
      ui.appendToolStart(name, typeof args === "string" ? args : JSON.stringify(args));
    });

    agent.on("tool_result", (name, output, isError, durationMs) => {
      if (isError) {
        ui.appendToolError(name, "", output, durationMs ?? 0);
      } else {
        ui.appendToolSuccess(name, "", output, durationMs ?? 0);
      }
    });

    agent.on("thinking", (text) => {
      ui.appendThinking(text);
    });

    // 输入回调
    ui.onInput(async (cmd) => {
      agent.addUserMessage(cmd);
      await agent.run();
      ui.showPrompt();
    });

    ui.start();
  }
}
```

## 设计演进：从全屏到追加式

轻灵的 TUI 经历了两次大的重构：

| 版本 | 界面风格 | 问题 |
|------|----------|------|
| v3 | 三栏全屏 TUI（清屏重绘） | Header 重复、边框穿插、历史被清 |
| v4 | Claude Code 风格（追加式） | ✅ 当前版本 |

v3 的问题：每次工具执行完都清屏重绘整个界面，导致：
- Header 重复出现三次
- 用户之前的输出被覆盖
- 边框错位

v4 的解决方案：**永不重绘，只追加**。每个事件只是 `process.stdout.write()` 追加一行。

## 小结

流式 TUI 的核心是：
1. ANSI 转义序列控制颜色和光标
2. 事件系统解耦 Agent 和 UI
3. 追加式输出避免重绘问题
4. `string-width` 处理 CJK 宽度

下一篇我们深入工具系统和 Pipeline：**如何让 Agent 干活**。

---

*上一篇：[从零搭建轻灵（二）：Agent Loop 核心循环](./02-agent-loop.md)*
*下一篇：[从零搭建轻灵（四）：工具系统与 Pipeline](./04-tools-and-pipeline.md)*
