# 🌬️ 轻灵 (Qingling)

轻量级 AI Agent CLI — 基于流式 TUI 的本地智能助手框架。

## ✨ v0.3 新特性 — 生产级演进

v0.3 版本在保持极致轻量级的同时，补齐了生产级 Agent 所需的记忆、编排与观测能力。

- **🧠 语义记忆增强 (Semantic Memory)** — 基于 SQLite 的本地向量索引，支持“向量 TopK + 关键词重排”的混合检索，大幅提升知识召回率。
- **⚙️ 状态机编排与 Checkpoint** — 引入代码优先的 Workflow DSL，所有状态迁移和工具执行实时落盘，支持崩溃后的断点续传。
- **👁️ 多模态视觉支持** — 新增 `vision_analyze` 工具，可直接分析本地截图或 UI 设计图，支持本地 (Ollama) 与云端模型。
- **📊 Observability Dashboard** — 内置本地 Web 控制台，白盒化展示 Agent 思考链路、状态机图、Tool 耗时与 Token 消耗。
- **📦 动态技能注册与发现** — 支持从本地目录或远程 URL 动态加载插件与技能，实现失效隔离与热更新。
- **🚀 Tool Spec 强约束 (Boost)** — 根据参数 Schema 自动生成调用示例，并增加前置一致性检查，显著降低 LLM 幻觉。

## ✨ 核心特性

- **流式 TUI** — Claude Code 风格的终端界面，实时展示思考、工具调用、验证结果
- **10 个内置工具** — bash、read, write, search, planner, skill, todo, url_fetch, subtask, vision_analyze
- **Pipeline 系统** — 可组合的 Hook（前置/后置）和 Section（系统提示词模块）
- **上下文压缩** — Token 预算耗尽时自动压缩历史，保持对话连续性
- **持久记忆** — 长期记忆存储，跨会话积累知识
- **会话管理** — 保存/恢复对话历史，随时中断和继续
- **验证修复** — 内置验证管线，工具输出错误时自动重试

## 🚀 快速开始

### 前置条件

- Node.js >= 18
- npm >= 9

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
# 全局命令优先（推荐）
npm link
qingling

# 新契约（推荐）
qingling chat
qingling repl
qingling run "你的任务描述"

# npm 脚本等价入口
npm start
npm run tui
npm run repl
npm run exec -- "你的任务描述"
```

## ⚙️ v0.3 特性开关 (Feature Flags)

所有新特性默认关闭，可通过 `.env` 或配置文件开启：

```bash
# 开启所有核心特性
QINGLING_FEATURES_SEMANTIC_MEMORY=true
QINGLING_FEATURES_WORKFLOW_RUNTIME=true
QINGLING_FEATURES_VISION_TOOL=true
QINGLING_FEATURES_DASHBOARD=true
QINGLING_FEATURES_DYNAMIC_DISCOVERY=true
QINGLING_FEATURES_TOOL_SPEC_BOOST=true

# 观测台配置
QINGLING_DASHBOARD_PORT=9999

# 视觉模型配置
QINGLING_VISION_PROVIDER=openai  # 或 deepseek, local
QINGLING_VISION_MODEL=gpt-4o
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
| `url_fetch` | 受 Guard 约束的结构化网络请求 | `url_fetch url="https://example.com"` |
| `subtask` | 隔离子任务执行 | `task="分析日志错误"` |
| `vision_analyze` | 多模态视觉解析 (v0.3) | `image_path="ui.png" prompt="分析布局"` |

## ⚙️ 配置与治理

- 配置优先级：`CLI flags > QINGLING_* ENV > config 文件 > 默认值`
- 支持 `--config <path>` 读取 `json/yaml` 配置
- 运行根目录：
  - `workspace_dir`
  - `file_cache_dir`
  - `file_state_dir`
- 路径别名（工具参数支持）：
  - `workspace_dir/...`
  - `file_cache_dir/...`
  - `file_state_dir/...`
- Guard M1：
  - URL 前缀白名单
  - 私网目标拦截
  - 重定向策略
  - 脱敏与 JSONL 审计日志
- Guard M2：
  - 滑动窗口速率限制（per tool per session）
  - 内容过滤（PII 检测 + Prompt Injection 扫描 + 自定义模式）
  - 工具权限矩阵（glob 匹配 allow/deny/ask）
  - 审批流（ApprovalGate：Promise 暂停 + 超时自动拒绝）

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
├── config.ts             # 配置加载与治理
├── guard.ts              # Guard 决策与审计
├── tools/
│   ├── index.ts          # 工具注册与调度
│   ├── bash.ts           # Shell 执行
│   ├── read.ts           # 文件读取
│   ├── write.ts          # 文件写入
│   ├── search.ts         # 文件搜索
│   ├── planner.ts        # 任务规划
│   ├── skill.ts          # 技能加载
│   ├── todo.ts           # 任务管理
│   └── url-fetch.ts      # 结构化网络请求（Guard）
├── pipeline/
│   ├── sections.ts       # 系统提示词 Section 管理
│   ├── hooks.ts          # 前置/后置 Hook
│   └── verification.ts   # 输出验证
├── guard/
│   ├── rate-limit.ts     # 滑动窗口速率限制器
│   ├── content-filter.ts # 内容过滤（PII/注入/自定义）
│   └── permissions.ts    # 工具权限矩阵
├── mcp/
│   ├── types.ts          # MCP 协议类型
│   ├── client.ts         # MCP 客户端（transport 抽象）
│   ├── stdio-transport.ts # stdio transport
│   ├── http-transport.ts # Streamable HTTP transport
│   ├── registry.ts       # 服务器生命周期管理
│   └── bridge.ts         # 工具桥接（命名空间映射）
├── channels/
│   ├── registry.ts       # 通道注册表
│   ├── console-channel.ts  # Console 通道
│   ├── telegram-channel.ts # Telegram 通道
│   └── slack-channel.ts    # Slack 通道
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

### MCP 服务器

支持连接外部 MCP (Model Context Protocol) 服务器，扩展工具能力：

```yaml
# config.yaml
mcp:
  servers:
    local-server:
      command: npx
      args: ["-y", "@example/mcp-server"]
      enabled: true
    remote-server:
      transport: http
      url: https://mcp.example.com
      headers:
        authorization: Bearer ${MCP_TOKEN}
      enabled: true
```

- **stdio transport**（默认）：启动子进程，通过 stdin/stdout 通信
- **http transport**：Streamable HTTP，POST + JSON/SSE 响应
- 工具命名空间：`mcp__{server}__{tool}`

### 通道

支持多种交互通道：

| 通道 | 说明 |
|------|------|
| Console | readline + approval 交互（仅 `run` 模式装配） |
| Telegram | axios + long-poll + inline keyboard（仅 `run` 模式装配） |
| Slack | axios + Web API polling（仅 `run` 模式装配） |

> 当前版本通道装配范围：**仅 `run` 模式生效**。`chat/repl` 继续使用原交互链路，不额外挂载 channel。

### 持久化指标

JSONL 格式指标收集，按日期分文件，支持自动 flush 和过期清理。记录 tool 调用、memory 操作、compaction 事件等。

## 💬 REPL 命令

| 命令 | 说明 |
|------|------|
| `!reset` | 重置对话 |
| `!save [name]` | 保存当前会话 |
| `!load [name]` | 恢复已保存的会话 |
| `!sessions` | 列出所有已保存会话 |
| `q` / `exit` | 退出 |

## ✅ 稳定性保障

- 已将核心高风险回归纳入自动化用例：
  - `search`：高命中小 `limit` 截断、`context` 输出差异、glob 过滤、Windows 路径兼容
  - `context-compactor`：tool_call/tool 链完整性保护
  - `agent-loop`：`user -> assistant(tool_calls) -> tool -> assistant` 最小链路 smoke
- 工具错误语义统一为：`Error: [CODE] message`（兼容原 `Error:` 前缀）
- 建议本地门禁命令：

```bash
npm run build
npm test
npm run test:smoke
```

- CI 最低门槛：`build + unit tests + smoke tests`（见 `.github/workflows/ci.yml`）

## 📄 License

MIT
