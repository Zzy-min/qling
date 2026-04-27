# 🌬️ 轻灵 (Qingling)

轻量级 AI Agent CLI — 基于流式 TUI 的本地智能助手框架。

## ✨ 特性

- **流式 TUI** — Claude Code 风格的终端界面，实时展示思考、工具调用、验证结果
- **7 个内置工具** — bash、read、write、search、planner、skill、todo
- **Pipeline 系统** — 可组合的 Hook（前置/后置）和 Section（系统提示词模块）
- **上下文压缩** — Token 预算耗尽时自动压缩历史，保持对话连续性
- **持久记忆** — 长期记忆存储，跨会话积累知识
- **会话管理** — 保存/恢复对话历史，随时中断和继续
- **验证修复** — 内置验证管线，工具输出错误时自动重试

## 🚀 快速开始

### 安装

```bash
git clone https://github.com/Zzy-min/qingling.git
cd qingling
npm install
npm run build
```

### 配置

复制环境变量模板并填入 API Key：

```bash
cp .env.example .env
```

需要配置：
- `OPENAI_API_KEY` 或 `DEEPSEEK_API_KEY` — LLM API 密钥
- `OPENAI_BASE_URL`（可选）— 自定义 API 端点

### 运行

```bash
# 流式 TUI 模式（推荐）
npm start

# 简易 REPL 模式
npm run repl

# 单次执行
npm run exec -- "你的任务描述"
```

## 🛠️ 工具一览

| 工具 | 说明 | 示例 |
|------|------|------|
| `bash` | 执行 Shell 命令 | `ls -la` |
| `read` | 读取文件内容 | `read src/index.ts` |
| `write` | 写入文件 | `write path output.txt` |
| `search` | 搜索文件内容/文件名 | `pattern="TODO" file_glob="*.ts"` |
| `planner` | 生成任务执行计划 | `goal="重构认证模块"` |
| `skill` | 加载和使用技能 | `skill "debug-patterns"` |
| `todo` | 任务列表管理 | `add "修复登录 bug"` |

## 📐 架构

```
src/
├── index.ts              # 入口 — CLI 参数解析
├── agent-loop.ts         # 核心 — Agent 循环、LLM 调用、事件分发
├── repl.ts               # 简易 REPL
├── knowledge-agent.ts    # 知识增强 Agent
├── context-compactor.ts  # 上下文压缩
├── memory.ts             # 持久记忆
├── types.ts              # 类型定义
├── tools/
│   ├── index.ts          # 工具注册与调度
│   ├── bash.ts           # Shell 执行
│   ├── read.ts           # 文件读取
│   ├── write.ts          # 文件写入
│   ├── search.ts         # 文件搜索
│   ├── planner.ts        # 任务规划
│   ├── skill.ts          # 技能加载
│   └── todo.ts           # 任务管理
├── pipeline/
│   ├── sections.ts       # 系统提示词 Section 管理
│   ├── hooks.ts          # 前置/后置 Hook
│   └── verification.ts   # 输出验证
└── tui/
    ├── streaming-tui.ts  # 流式 TUI 主类（事件渲染）
    └── streaming-repl.ts # 流式 REPL（Agent + TUI 集成）
```

### Agent 循环

```
用户输入 → buildSystemPrompt → chat(LLM) → 解析 tool_calls
  → dispatchAll(工具) → 验证 → 修复(如需) → 追加上下文
  → 再次 chat ... → 最终回答 → appendFinal
```

### Pipeline 系统

- **Sections**: 模块化的系统提示词片段，支持动态内容（如 Token 预算）
- **Hooks**: 工具调用前后的拦截器，可用于修改输入/输出或注入逻辑
- **Verification**: 验证工具输出是否符合预期，失败时触发自动修复

## 💬 REPL 命令

| 命令 | 说明 |
|------|------|
| `!reset` | 重置对话 |
| `!save [name]` | 保存当前会话 |
| `!load [name]` | 恢复已保存的会话 |
| `!sessions` | 列出所有已保存会话 |
| `q` / `exit` | 退出 |

## 📄 License

MIT
