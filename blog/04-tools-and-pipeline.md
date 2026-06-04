# 从零搭建轻灵（四）：工具系统与 Pipeline

> 这是「从零搭建轻灵」系列的第4篇。我们实现让 Agent 真正「干活」的工具系统，以及控制工具行为的 Pipeline。

## 工具系统架构

```
tools/
├── index.ts          # 工具注册表 + 统一分发
├── bash.ts           # Shell 执行
├── read.ts           # 文件读取
├── write.ts          # 文件写入
├── search.ts         # 内容搜索（ripgrep）
├── planner.ts        # 任务规划
├── skill.ts          # 技能加载
├── todo.ts           # 任务列表
├── url-fetch.ts      # HTTP 抓取
├── browser-fetch.ts  # Playwright 浏览器抓取
├── subtask.ts        # 子任务隔离
└── vision-analyze.ts # 多模态视觉
```

每个工具导出两个东西：

```typescript
// tools/bash.ts
export const bashDefinition = {
  type: "function",
  function: {
    name: "bash",
    description: "执行 Shell 命令",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "要执行的命令" }
      },
      required: ["command"]
    }
  }
};

export async function bashExecute(args: { command: string }): Promise<ToolResult> {
  const { execSync } = await import("child_process");
  try {
    const output = execSync(args.command, {
      encoding: "utf-8",
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    return { output: output.trim(), is_error: false };
  } catch (err: any) {
    return {
      output: err.stderr || err.message,
      is_error: true
    };
  }
}
```

## 工具注册表

`tools/index.ts` 是统一入口：

```typescript
import { bashDefinition, bashExecute } from "./bash.js";
import { readDefinition, readExecute } from "./read.js";
// ... 其他工具

export const ALL_TOOLS = [
  bashDefinition,
  readDefinition,
  writeDefinition,
  searchDefinition,
  plannerDefinition,
  skillDefinition,
  todoDefinition,
  urlFetchDefinition,
  browserFetchDefinition,
  subtaskDefinition,
  visionAnalyzeDefinition,
];

// 工具名 → 执行函数的映射
const executors = new Map<string, Function>([
  ["bash", bashExecute],
  ["read", readExecute],
  ["write", writeExecute],
  ["search", searchExecute],
  // ...
]);

export async function dispatch(
  toolName: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const executor = executors.get(toolName);
  if (!executor) {
    return { output: `Unknown tool: ${toolName}`, is_error: true };
  }
  return await executor(args);
}
```

## 实现关键工具

### 1. Bash — 最重要的工具

```typescript
export async function bashExecute(args: { command: string }): Promise<ToolResult> {
  const { execSync } = await import("child_process");

  // 安全检查（Guard M1）
  const DANGEROUS_PATTERNS = [
    /\b(rm\s+-rf|mkfs|dd\s+|truncate\s+-s\s+0|shred)\b/,
    /\|\s*rm\s+/,
    /;\s*rm\s+/,
  ];

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(args.command)) {
      return { output: "Command blocked by safety guard", is_error: true };
    }
  }

  try {
    const output = execSync(args.command, {
      encoding: "utf-8",
      timeout: 30_000,
      maxBuffer: 1024 * 1024, // 1MB
      cwd: process.env.QLING_WORKSPACE_DIR ?? process.cwd(),
    });
    return { output: output.trim(), is_error: false };
  } catch (err: any) {
    return { output: err.stderr || err.message, is_error: true };
  }
}
```

**⚠️ 踩过的坑**：正则 `/\b(write|edit|delete|remove|rm)\b/` 会误拦截 `curl`（包含 `rm` 子串）。改为只拦截明确的危险命令。

### 2. Search — 基于 ripgrep

```typescript
export async function searchExecute(args: {
  pattern: string;
  path?: string;
  file_glob?: string;
  limit?: number;
}): Promise<ToolResult> {
  const { execSync } = await import("child_process");

  let cmd = `rg --no-heading -n "${args.pattern}"`;
  if (args.path) cmd += ` "${args.path}"`;
  if (args.file_glob) cmd += ` -g "${args.file_glob}"`;
  if (args.limit) cmd += ` -m ${args.limit}`;

  try {
    const output = execSync(cmd, { encoding: "utf-8", timeout: 10_000 });
    return { output: output.trim(), is_error: false };
  } catch (err: any) {
    return { output: err.stderr || "No matches found", is_error: true };
  }
}
```

### 3. Browser Fetch — Playwright 集成

```typescript
export async function browserFetchExecute(args: {
  url: string;
  waitMs?: number;
}): Promise<ToolResult> {
  const { chromium } = await import("playwright");

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(args.url, { waitUntil: "networkidle" });
    await page.waitForTimeout(args.waitMs ?? 2000); // 等待 JS 渲染

    const text = await page.evaluate(() => {
      // 提取核心文本内容
      const el = document.querySelector("main") ?? document.body;
      return el?.innerText ?? "";
    });

    await browser.close();
    return { output: text.slice(0, 5000), is_error: false };
  } catch (err: any) {
    await browser.close();
    return { output: err.message, is_error: true };
  }
}
```

### 4. Vision Analyze — 多模态

```typescript
export async function visionAnalyzeExecute(args: {
  image_path: string;
  prompt: string;
}): Promise<ToolResult> {
  const fs = await import("fs/promises");
  const imageBuffer = await fs.readFile(args.image_path);
  const base64 = imageBuffer.toString("base64");

  const response = await axios.post(
    `${endpoint}/chat/completions`,
    {
      model: "gpt-4o",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: args.prompt },
          {
            type: "image_url",
            image_url: { url: `data:image/png;base64,${base64}` }
          }
        ]
      }],
      max_tokens: 1000,
    },
    { headers: { Authorization: `Bearer ${apiKey}` } }
  );

  return {
    output: response.data.choices[0].message.content,
    is_error: false
  };
}
```

## Pipeline 系统

Pipeline 是工具执行的「流水线」，包含三个核心概念：

### 1. Hook（前置/后置钩子）

```typescript
// pipeline/hooks.ts
class HookManager {
  private beforeHooks: Map<string, Function[]> = new Map();
  private afterHooks: Map<string, Function[]> = new Map();

  registerBefore(toolName: string, hook: Function): void {
    if (!this.beforeHooks.has(toolName)) {
      this.beforeHooks.set(toolName, []);
    }
    this.beforeHooks.get(toolName)!.push(hook);
  }

  registerAfter(toolName: string, hook: Function): void {
    if (!this.afterHooks.has(toolName)) {
      this.afterHooks.set(toolName, []);
    }
    this.afterHooks.get(toolName)!.push(hook);
  }
}
```

用法示例：在 `bash` 执行前检查命令安全性：

```typescript
hookManager.registerBefore("bash", async (args) => {
  // Guard 检查
  if (isDangerousCommand(args.command)) {
    throw new Error("Command blocked by safety guard");
  }
});
```

### 2. Section（系统提示词模块）

系统提示词不是一大段文本，而是由多个 Section 组合而成：

```typescript
// pipeline/sections.ts
const SECTION_IDS = {
  ROLE: "role",
  TOOLS: "tools",
  MEMORY: "memory",
  SKILLS: "skills",
  CONSTRAINTS: "constraints",
};

function buildSystemPrompt(registry: SectionRegistry): string {
  const sections = registry.getAll();
  return sections
    .sort((a, b) => a.priority - b.priority)
    .map((s) => s.content)
    .join("\n\n");
}
```

每个 Section 可以动态启用/禁用：

```typescript
registry.register({
  id: "memory",
  priority: 30,
  content: buildMemorySection(memoryStore),
});

registry.register({
  id: "skills",
  priority: 40,
  content: buildSkillsSection(availableSkills),
});
```

### 3. Verification（验证）

工具执行完后，验证输出是否合理：

```typescript
// pipeline/verification.ts
class VerificationAgent {
  async verify(toolName: string, args: any, output: string): Promise<Verdict> {
    // 规则优先（不调用 LLM）
    if (output.length < 100 || /denied|not found|Error/i.test(output)) {
      return { isOk: false, reason: "rule-based denial" };
    }

    // LLM 辅助验证（低 token 预算）
    const response = await this.client.post("/chat/completions", {
      model: this.model,
      messages: [{
        role: "user",
        content: `验证工具输出是否合理。工具: ${toolName}, 输出: ${output.slice(0, 200)}。只输出一行：✅ 通过 或 ❌ 原因`
      }],
      max_tokens: 150, // 极低预算
    });

    const verdict = response.data.choices[0].message.content;
    return {
      isOk: verdict.includes("✅"),
      reason: verdict,
    };
  }
}
```

## 工具执行流程

```
LLM 返回 tool_call
  │
  ├─→ Hook.before("bash", args)    ← 安全检查
  │
  ├─→ bashExecute(args)            ← 实际执行
  │
  ├─→ Hook.after("bash", result)   ← 后处理
  │
  ├─→ Verification.verify(...)     ← 验证输出
  │     ├── PASS → 返回结果
  │     └── FAIL → 修复重试
  │
  └─→ 返回 ToolResult
```

## 完整代码：ToolPipeline

```typescript
class ToolPipeline {
  private hookManager: HookManager;
  private verifier: VerificationAgent;

  async execute(
    toolCall: ToolCall,
    dispatch: Function
  ): Promise<ToolResult> {
    const { name, arguments: args } = toolCall.function;
    const parsedArgs = typeof args === "string" ? JSON.parse(args) : args;

    // 1. 前置 Hook
    await this.hookManager.runBefore(name, parsedArgs);

    // 2. 执行工具
    const startTime = Date.now();
    const result = await dispatch(name, parsedArgs);
    const durationMs = Date.now() - startTime;

    // 3. 后置 Hook
    await this.hookManager.runAfter(name, parsedArgs, result);

    // 4. 验证（可选）
    if (this.verifier) {
      const verdict = await this.verifier.verify(name, parsedArgs, result.output);
      if (!verdict.isOk) {
        // 触发修复流程
        return this.repair(name, parsedArgs, result, verdict.reason);
      }
    }

    return { ...result, durationMs };
  }
}
```

## 小结

工具系统的要点：
1. **统一接口**：每个工具导出 definition + execute
2. **可插拔**：通过注册表动态添加/移除工具
3. **Pipeline 控制**：Hook、Section、Verification 三层控制
4. **安全第一**：Guard 拦截危险操作

下一篇我们讲**记忆系统和生产化特性**——让 Agent 有长期记忆、能跑后台任务。

---

*上一篇：[从零搭建轻灵（三）：流式 TUI 终端界面](./03-streaming-tui.md)*
*下一篇：[从零搭建轻灵（五）：记忆系统与生产化特性](./05-memory-and-production.md)*
