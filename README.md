# 🌬️ 轻灵 (qling)

轻量级 AI Agent CLI — 基于流式 TUI 的本地智能助手框架。

## ✨ v0.5 新特性 — 生产级演进

v0.5 版本在保持极致轻量级的同时，补齐了生产级 Agent 所需的记忆、编排、观测与自动化浏览器能力。

- **🌐 自动化浏览器抓取 (Browser Fetch)** — 集成 Playwright，支持抓取现代 JS 渲染的网页、SPA 应用，并自动提取核心内容摘要。
- **🎯 Mission 任务系统** — 引入长任务管理机制，支持任务的创建、持久化状态流转与历史溯源，解决复杂任务跨会话执行问题。
- **🧠 语义记忆增强 (Semantic Memory)** — 基于 SQLite 的本地向量索引，支持“向量 TopK + 关键词重排”的混合检索，大幅提升知识召回率。
- **⚙️ 状态机编排与 Checkpoint** — 引入代码优先的 Workflow DSL，所有状态迁移和工具执行实时落盘，支持崩溃后的断点续传。
- **👁️ 多模态视觉支持** — 内置 `vision_analyze` 工具，可直接分析本地截图或 UI 设计图，支持本地 (Ollama) 与云端模型。
- **📊 Observability Dashboard** — 内置本地 Web 控制台，白盒化展示 Agent 思考链路、状态机图、Tool 耗时与 Token 消耗。
- **📦 动态技能注册与发现** — 支持从本地目录或远程 URL 动态加载插件与技能，实现失效隔离与热更新。
- **🚀 交互式 Onboarding** — 新增 `qling setup` 引导，支持国内主流 Provider (DeepSeek, Zhipu, etc.) 的一键配置。

## ✨ 核心特性

- **流式 TUI** — Claude Code 风格的终端界面，实时展示思考、工具调用、验证结果
- **11 个内置工具** — bash、read, write, search, planner, skill, todo, url_fetch, browser_fetch, subtask, vision_analyze
- **Pipeline 系统** — 可组合的 Hook（前置/后置）和 Section（系统提示词模块）
- **上下文压缩** — Token 预算耗尽时自动压缩历史，保持对话连续性
- **持久记忆** — 长期记忆存储，跨会话积累知识
- **会话管理** — 保存/恢复对话历史，随时中断和继续
- **验证修复** — 内置验证管线，工具输出错误时自动重试

## 🚀 快速开始

### 前置条件

- Node.js >= 18
- npm >= 9
- [可选] Playwright 依赖（用于 `browser_fetch`）

### 安装

```bash
git clone https://github.com/Zzy-min/qling.git
cd qling
npm install
npx playwright install chromium # 如果需要浏览器功能
npm run build
```

### 配置

您可以手动配置 `.env` 文件，或者使用新增的交互式配置向导：

```bash
# 推荐：使用配置向导（支持国内主流 Provider 预设）
qling setup
```

或者手动复制模板：

```bash
cp .env.example .env
```

需要配置：
- `OPENAI_API_KEY` 或 `DEEPSEEK_API_KEY` — LLM API 密钥
- `OPENAI_BASE_URL`（可选）— 自定义 API 端点

### 运行

```bash
# 全局命令优先（推荐）
npm link
qling

# 新契约（推荐）
qling chat
qling repl
qling run "你的任务描述"

# npm 脚本等价入口
npm start
npm run tui
npm run repl
npm run exec -- "你的任务描述"
```

## ⚙️ 特性开关 (Feature Flags)

所有新特性默认关闭，可通过 `.env` 或配置文件开启：

```bash
# 开启所有核心特性
QLING_FEATURES_SEMANTIC_MEMORY=true
QLING_FEATURES_WORKFLOW_RUNTIME=true
QLING_FEATURES_VISION_TOOL=true
QLING_FEATURES_DASHBOARD=true
QLING_FEATURES_DYNAMIC_DISCOVERY=true
QLING_FEATURES_TOOL_SPEC_BOOST=true
QLING_FEATURES_MISSION_SYSTEM=true

# 观测台配置
QLING_DASHBOARD_PORT=9999

# 视觉模型配置
QLING_VISION_PROVIDER=openai  # 或 deepseek, local
QLING_VISION_MODEL=gpt-4o
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
| `url_fetch` | 轻量级结构化网络请求 | `url_fetch url="https://example.com"` |
| `browser_fetch` | 自动化浏览器网页抓取 (v0.5) | `browser_fetch url="https://nextjs.org"` |
| `subtask` | 隔离子任务执行 | `task="分析日志错误"` |
| `vision_analyze` | 多模态视觉解析 (v0.3+) | `image_path="ui.png" prompt="分析布局"` |

## 📐 架构

```
src/
├── agent/                # Agent 核心逻辑
├── channels/             # 交互通道 (Console, TG, Slack)
├── cli/                  # CLI 命令解析与 UI
├── guard/                # 治理与安全 (速率限制, 内容过滤, 权限)
├── mcp/                  # MCP 协议客户端与桥接
├── memory/               # 记忆系统 (WAL, 语义向量, Checkpoint)
├── metrics/              # 遥测与指标收集
├── mission/              # Mission 任务管理 (v0.5)
├── onboarding/           # 交互式配置引导 (v0.5)
├── pipeline/             # Pipeline 系统 (Sections, Hooks, Verification)
├── tools/                # 内置工具集
├── tui/                  # 流式 TUI 渲染引擎
├── agent-loop.ts         # Agent 主循环
├── daemon.ts             # 后台守护进程 (v0.5)
├── dashboard-server.ts   # 观测台服务端
└── discovery-registry.ts # 动态技能发现
```

### Agent 循环

```
用户输入 → buildSystemPrompt → chat(LLM) → 解析 tool_calls
  → dispatchAll(工具) → 验证 → 修复(如需) → 追加上下文
  → 再次 chat ... → 最终回答 → appendFinal
```

### Mission 任务系统 (v0.5)

Mission 系统允许 Agent 处理跨会话的长任务。每个 Mission 都有独立的 ID、持久化的状态定义和执行度量：

1. **持久化**: 任务状态实时同步到本地 JSON 库。
2. **队列管理**: 支持任务的优先级调度与状态流转（Queued -> Running -> Succeeded/Failed）。
3. **可观测性**: 记录每个任务的总耗时、Token 消耗与工具调用次数。

## ✅ 稳定性保障

- 已将核心高风险回归纳入自动化用例：
  - `search`：高命中小 `limit` 截断、`context` 输出差异、glob 过滤、Windows 路径兼容
  - `context-compactor`：tool_call/tool 链完整性保护
  - `agent-loop`：`user -> assistant(tool_calls) -> tool -> assistant` 最小链路 smoke
- 建议本地门禁命令：

```bash
npm run build
npm test
npm run test:smoke
```

## 📄 License

MIT


## 📄 License

MIT
