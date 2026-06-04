# 从零搭建轻灵（一）：架构总览与技术选型

> 这是「从零搭建轻灵」系列的第1篇。我们先搞清楚整个项目长什么样，再动手写代码。

## 项目结构

```
qling/
├── src/
│   ├── index.ts              # CLI 入口（模式路由）
│   ├── agent-loop.ts         # 核心：Agent 主循环
│   ├── types.ts              # 全局类型定义
│   ├── config.ts             # 配置加载（YAML + ENV）
│   ├── context-compactor.ts  # 上下文压缩器
│   ├── memory.ts             # 记忆存储层
│   ├── repl.ts               # 旧版纯文字 REPL（已废弃）
│   │
│   ├── tui/                  # 终端界面
│   │   ├── streaming-tui.ts  # 核心：StreamUI 类
│   │   └── streaming-repl.ts # 桥接 AgentLoop + StreamUI
│   │
│   ├── tools/                # 内置工具集
│   │   ├── index.ts          # 工具注册表
│   │   ├── bash.ts           # Shell 执行
│   │   ├── read.ts           # 文件读取
│   │   ├── write.ts          # 文件写入
│   │   ├── search.ts         # 内容搜索（ripgrep）
│   │   ├── planner.ts        # 任务规划
│   │   ├── skill.ts          # 技能加载
│   │   ├── todo.ts           # 任务列表
│   │   ├── url-fetch.ts      # HTTP 抓取
│   │   ├── browser-fetch.ts  # Playwright 浏览器抓取
│   │   ├── subtask.ts        # 子任务隔离
│   │   └── vision-analyze.ts # 多模态视觉
│   │
│   ├── pipeline/             # Pipeline 系统
│   │   ├── hooks.ts          # 前置/后置 Hook
│   │   ├── sections.ts       # 系统提示词模块
│   │   └── verification.ts   # 工具输出验证
│   │
│   ├── memory/               # 记忆子系统
│   │   ├── wal.ts            # Write-Ahead Log
│   │   ├── embedding.ts      # 向量嵌入客户端
│   │   ├── cognitive-index.ts# 语义索引（SQLite + 向量）
│   │   └── semantic-index.ts # 向量存储
│   │
│   ├── guard/                # 治理与安全
│   │   ├── approval.ts       # 工具调用审批
│   │   ├── content-filter.ts # 内容过滤
│   │   ├── permissions.ts    # 权限矩阵
│   │   └── rate-limit.ts     # 速率限制
│   │
│   ├── mcp/                  # MCP 协议客户端
│   │   ├── client.ts
│   │   ├── registry.ts
│   │   ├── bridge.ts
│   │   ├── stdio-transport.ts
│   │   └── http-transport.ts
│   │
│   ├── mission/              # Mission 任务系统
│   │   ├── manager.ts
│   │   └── types.ts
│   │
│   ├── session/              # 会话管理
│   ├── channels/             # 多通道输出
│   ├── metrics/              # 遥测指标
│   └── cli/                  # CLI 命令解析
│
├── tests/
│   ├── unit/                 # 单元测试
│   └── smoke/                # 冒烟测试
│
├── docs/superpowers/         # 设计文档（specs/plans/reviews）
├── package.json
├── tsconfig.json
└── .env
```

## 核心设计决策

### 1. ESM 模块系统

```json
// package.json
{
  "type": "module"
}
```

```typescript
// tsconfig.json
{
  "compilerOptions": {
    "module": "Node16",
    "moduleResolution": "Node16",
    "target": "ES2022"
  }
}
```

**为什么选 ESM？** Node.js 的未来是 ESM，TypeScript 对 ESM 的支持已经足够成熟。所有 import 路径都带 `.js` 后缀：

```typescript
import { AgentLoop } from "./agent-loop.js";
import { dispatch, ALL_TOOLS } from "./tools/index.js";
```

这虽然写起来多打几个字符，但在 ESM 下是必需的（TypeScript 编译后保留 `.js` 后缀）。

### 2. 双入口架构

```typescript
// src/index.ts
const decision = parseCliArgs(process.argv.slice(2));

// 三种启动模式：
// qling                    → chat (TUI，默认)
// qling run "任务"        → run（单次执行）
// qling repl              → repl（纯文字 REPL）
```

| 命令 | 入口文件 | 界面 |
|------|----------|------|
| `qling` / `qling chat` | `streaming-repl.ts` | 流式 TUI |
| `qling repl` | `repl.ts` | 纯文字 REPL |
| `qling run "任务"` | `agent-loop.ts` | 无界面，直接输出 |

### 3. 配置优先级

```
CLI 参数 > 环境变量 > 配置文件 > 默认值
```

```typescript
// config.ts 的加载顺序
const envPaths = findEnvPaths(); // 项目 .env → ~/.qling/.env → cwd/.env
for (const p of envPaths) {
  dotenv.config({ path: p });
}
```

## Agent 循环：最核心的流程

整个轻灵的心脏是一个 **ReAct 循环**（Reasoning + Acting）：

```
┌─────────────────────────────────────────────────────┐
│                    Agent Loop                        │
│                                                     │
│  ① 收到用户输入                                      │
│  ② 构建系统提示词（Pipeline Sections）                │
│  ③ 发送到 LLM（带工具定义）                           │
│  ④ 解析 LLM 返回                                    │
│     ├── 纯文本回答 → 输出，结束                       │
│     └── tool_calls → ⑤ 执行工具                      │
│  ⑤ 执行工具（Pipeline Hook 前置 → 执行 → Hook 后置）  │
│  ⑥ 工具输出追加到上下文                               │
│  ⑦ 验证工具输出（Verification）                       │
│     ├── 通过 → 回到 ③                                │
│     └── 失败 → 修复重试                              │
│  ⑧ Token 预算检查                                    │
│     ├── 充足 → 回到 ③                                │
│     └── 不足 → 压缩上下文                             │
└─────────────────────────────────────────────────────┘
```

这个循环的代码在 `agent-loop.ts` 的 `run()` 方法中，大约 200 行，但承载了整个系统的核心逻辑。我们在第2篇会详细拆解它。

## 事件系统：让 TUI 能看到发生了什么

Agent Loop 执行过程中，TUI 需要知道「AI 在想什么」「工具执行到哪了」。我们用一个轻量级事件发射器实现：

```typescript
// agent-loop.ts
class AgentEventEmitter {
  private handlers = new Map<string, Set<Function>>();

  on(event: string, handler: Function): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
    return () => this.handlers.get(event)?.delete(handler);
  }

  emit(event: string, ...args: unknown[]): void {
    this.handlers.get(event)?.forEach((h) => h(...args));
  }
}

// AgentLoop 继承事件发射器
class AgentLoop extends AgentEventEmitter {
  async run(): Promise<string> {
    // ...
    this.emit("tool_start", tc.name, tc.arguments);
    const result = await this.pipeline.execute(tc, dispatch);
    this.emit("tool_result", tc.name, result.output, result.is_error);
    // ...
  }
}
```

TUI 端监听这些事件：

```typescript
// streaming-repl.ts
agent.on("tool_start", (name, args) => {
  ui.appendToolStart(name, JSON.stringify(args));
});
agent.on("tool_result", (name, output, isError) => {
  if (isError) {
    ui.appendToolError(name, "", output, durationMs);
  } else {
    ui.appendToolSuccess(name, "", output, durationMs);
  }
});
```

**为什么不用 EventEmitter？** Node.js 自带的 EventEmitter 是为 IO 流设计的，类型不安全。我们只需要 `on` + `emit` 两个方法，30 行代码就够了。

## 目录结构的设计哲学

```
src/
├── agent-loop.ts      ← 大脑（唯一的循环）
├── tools/             ← 手脚（可插拔的工具）
├── pipeline/          ← 流水线（Hook + Section + Verification）
├── memory/            ← 记忆（短期 + 长期 + 向量）
├── guard/             ← 安全（审批 + 过滤 + 权限）
├── mcp/               ← 协议（外部工具接入）
├── tui/               ← 眼睛（终端界面）
├── mission/           ← 长任务（跨会话执行）
└── channels/          ← 通道（TG/Slack/Console）
```

**核心原则**：每个模块只做一件事，通过事件或接口通信。Agent Loop 是唯一的协调者。

## 下一步

架构看完了，下一篇我们深入最核心的部分：**Agent Loop 的实现**。包括：

- 如何与 DeepSeek API 交互
- 如何解析 Tool Calling 响应
- 如何管理上下文窗口
- 如何处理 Token 预算耗尽

---

*下一篇：[从零搭建轻灵（二）：Agent Loop 核心循环](./02-agent-loop.md)*
