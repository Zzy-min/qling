# 轻灵 Qling

轻灵是一个本地优先的 AI Agent CLI。它不是 Claude Code 的复制品，而是面向中文开发者和本机工作流的终端控制台：把会话、上下文、工具执行、skill、任务、权限、诊断和恢复能力收拢到一个可审计、可中断、可继续的命令行界面里。

一句话：轻灵让 Agent 像一个本地工作台，而不是一个黑盒聊天窗口。

## 为什么是轻灵

| 特点 | 轻灵的做法 |
|---|---|
| 本地优先 | 会话、checkpoint、导出、记忆、任务和诊断默认落在本机；`/privacy` 可直接查看边界。 |
| 中文可用 | TUI、帮助、快捷键、状态提示和大部分交互文案面向中文终端使用场景。 |
| Slash 控制面 | `/` 打开命令面板，过滤、参数提示、方向键选择、`Tab` 补全都在当前输入框内完成。 |
| 可恢复长任务 | `/checkpoint`、`/resume`、`/rewind`、`--continue` 让中断后的上下文可以继续接上。 |
| 本地 skill | `skills/` 与 `.qling/skills/` 中的 Markdown skill 可被 `/skill` 或 `/<skill-name>` 直接读取。 |
| 权限可解释 | `/permissions`、`/hooks`、guard、内容过滤、速率限制和密钥脱敏都以本地规则呈现。 |
| 上下文透明 | `/context`、`/usage` 显示 token 来源、估算、上下文预算和压缩状态。 |
| 诊断内建 | `/doctor`、`/config`、`/mcp`、`/diff` 用于快速判断当前项目和运行时状态。 |

轻灵兼容 Claude Code 式 slash-first 使用习惯，但不依赖 Claude 账号、桌面端、移动端或云端工作流。平台专属命令会被识别并给出本地边界说明，不会伪装成功。

## 核心体验

### 终端不是日志流，而是控制台

轻灵的 TUI 由顶栏、角色块、工具执行时间线、结果框、状态线和完整输入框组成。它保留纯终端兼容性，不使用全屏 alt-screen，也不强制引入重型 TUI 依赖。

### `/` 是主入口

输入 `/` 后，轻灵会显示命令候选、分类、参数提示和简短说明。输入 `/mo` 可过滤到 `/model`，输入 `/skill ` 会显示 skill 参数提示。`Enter` 永远只提交当前输入，不会因为候选被选中而误执行。

### skill 是本地知识，不是远程插件黑盒

本地 skill 本质上是 Markdown 文件。你可以列出、搜索、读取，也可以通过 `/<skill-name>` 直接打开。内置命令优先级高于 skill，避免本地文件覆盖 `/clear`、`/model` 等控制命令。

### 恢复能力是一等能力

轻灵把会话恢复、checkpoint、导出、目标、任务和上下文压缩放在显式命令里，而不是隐藏在自动行为中。你可以随时看见当前状态，也可以决定下一步如何恢复。

## 快速开始

### 环境要求

- Node.js >= 18
- npm >= 9
- 可选：Playwright Chromium，用于 `browser_fetch`

### 安装

```bash
git clone https://github.com/Zzy-min/qling.git
cd qling
npm install
npm run build
```

可选浏览器能力：

```bash
npx playwright install chromium
```

可选全局命令：

```bash
npm link
qling
```

## 配置

使用交互式配置：

```bash
qling setup
```

或手动创建 `.env`：

```bash
cp .env.example .env
```

常用变量：

```bash
DEEPSEEK_API_KEY=sk-...
QLING_LLM_PROVIDER=deepseek
QLING_LLM_ENDPOINT=https://api.deepseek.com
QLING_LLM_MODEL=deepseek-chat
```

轻灵支持 OpenAI-compatible provider。通过 `QLING_LLM_ENDPOINT`、`QLING_LLM_MODEL` 和对应 API key 环境变量即可接入兼容模型服务。

## 运行方式

```bash
qling                         # 默认进入 streaming TUI
qling chat                    # 显式进入 TUI
qling repl                    # 简单 REPL
qling run "分析这个仓库"      # 单次执行
qling --continue              # 恢复最近交互会话
qling --resume <session>      # 恢复指定会话
```

npm script：

```bash
npm run tui
npm run repl
npm run exec -- "分析这个仓库"
```

## 命令面板

在 TUI 中输入 `/` 打开命令面板。输入前缀过滤候选，使用 `↑/↓` 移动选择，`Tab` 接受当前候选并保留尾随空格，`Enter` 执行输入框里的文本。

### 会话与恢复

| Command | Purpose |
|---|---|
| `/checkpoint [name] [--force]` | 保存本地恢复点。 |
| `/sessions` | 列出已保存会话。 |
| `/resume [session\|latest]` | 恢复指定会话或最近会话。 |
| `/rewind`, `/undo` | 显示可恢复点和下一步恢复命令；不自动回滚代码。 |
| `/clear`, `/reset`, `/new` | 清空当前对话上下文。 |
| `/compact` | 手动压缩上下文。 |
| `/export` | 将当前会话导出为本地 Markdown。 |
| `/exports [count]` | 查看最近导出。 |

### 模型、上下文与用量

| Command | Purpose |
|---|---|
| `/model [model]` | 显示或切换当前 session 模型；不写入配置文件。 |
| `/usage`, `/cost`, `/stats` | 显示 token 来源、用量、上下文预算和压缩状态。 |
| `/context` | 查看本地上下文和 token 使用情况。 |
| `/statusline [on\|off]` | 显示或切换输入区状态线。 |

### 工作推进

| Command | Purpose |
|---|---|
| `/plan [description]` | 在当前会话中排入普通计划请求。 |
| `/goal [status\|set <condition>\|clear]` | 管理当前 session 目标。 |
| `/loop [interval] [prompt]` | 创建本地重复提示任务。 |
| `/tasks [cancel <id>\|clear]` | 查看或管理本地 loop 任务。 |
| `/agents` | 查看本地后台 mission 分组。 |
| `/mission ...` | 管理本地 mission。 |

### 本地知识与 skill

| Command | Purpose |
|---|---|
| `/skill`, `/skill list` | 列出本地 skills。 |
| `/skill search <query>` | 按名称、描述或标签搜索本地 skills。 |
| `/skill <name>` | 读取指定本地 skill Markdown。 |
| `/<skill-name>` | 直接调用本地 skill；内置命令优先。 |
| `/memory ...` | 查看本地记忆、来源、实践、图谱或详情。 |
| `/dream [count]` | 从当前对话信号中蒸馏本地记忆。 |
| `/distill [count]` | 查看本地沉淀实践。 |

### 项目、权限与诊断

| Command | Purpose |
|---|---|
| `/help [topic]` | 查看全部 slash 命令或聚焦主题帮助。 |
| `/diff` | 只读查看 Git 状态和 diff 摘要。 |
| `/copy [N]` | 复制最近第 N 条 assistant 回复到剪贴板。 |
| `/init [--force]` | 创建本地 `AGENTS.md` 项目引导；默认不覆盖。 |
| `/privacy` | 查看本地数据留存路径和边界。 |
| `/permissions [status\|allow\|deny\|ask]` | 查看或切换本地工具权限默认策略。 |
| `/permissions explain <tool>` | 解释某个工具的本地权限决策。 |
| `/doctor` | 运行本地诊断。 |
| `/config` | 查看已脱敏的有效配置。 |
| `/mcp` | 查看本地 MCP server 配置摘要。 |
| `/hooks` | 查看 hooks 与 guard 配置摘要。 |
| `/shortcuts` | 查看 TUI 快捷键。 |

## TUI 快捷键

| Key | Behavior |
|---|---|
| `Enter` | 发送当前输入。 |
| `Ctrl+C` | 非空输入先清空草稿；空输入连续两次退出。 |
| `Ctrl+Z` | 恢复被 `Ctrl+C` 清掉的草稿。 |
| `Ctrl+D` | 仅在输入为空时退出。 |
| `Ctrl+L` | 清屏并重绘。 |
| `Ctrl+O` | 切换后续长工具输出展开。 |
| `Ctrl+R` | 搜索本地输入历史。 |
| `Ctrl+N` | 插入换行。 |
| `Tab` | 空输入打开 `/agents`；slash 前缀补全选中命令。 |
| `↑/↓` | slash 面板打开时移动选择；否则浏览输入历史。 |

## 内置工具

| Tool | Purpose |
|---|---|
| `bash` | 通过 guard 管线执行 shell 命令。 |
| `read` | 读取本地文件，带大小和二进制保护。 |
| `write` | 写入本地文件。 |
| `search` | 搜索本地文件和内容。 |
| `planner` | 生成结构化任务计划。 |
| `skill` | 加载本地 Markdown skills。 |
| `todo` | 管理本地任务列表。 |
| `url_fetch` | 在 guard 策略下抓取允许的远程 URL。 |
| `browser_fetch` | 通过 Playwright 获取浏览器渲染页面。 |
| `subtask` | 运行隔离子任务 agent。 |
| `vision_analyze` | 使用配置的视觉 provider 分析本地图片。 |

## 本地数据边界

轻灵默认把运行态数据写入本地 qling state 目录，常见内容包括：

- saved sessions
- checkpoints
- exports
- memory indexes
- session goals
- loop tasks
- mission metadata
- guard and diagnostics artifacts

查看边界：

```bash
qling privacy
qling storage
qling doctor
```

TUI 内：

```text
/privacy
/storage
/doctor
/context
```

## 项目结构

```text
src/
  agent-loop.ts          Agent loop and model/tool orchestration
  cli/                   CLI startup contract and setup flow
  commands/              Slash command implementations
  guard/                 Permissions, content filtering, audit, rate limits
  mcp/                   MCP client and bridge
  memory/                WAL, memory projection, semantic memory
  metrics/               Local telemetry and observability
  mission/               Background mission state machine
  pipeline/              Prompt sections, hooks, verification
  session/               Session registry, goals, tasks, scheduler
  skills/                Local skill registry
  tools/                 Built-in tool implementations
  tui/                   Streaming terminal UI
tests/
  unit/                  Unit coverage
  smoke/                 End-to-end smoke coverage
docs/superpowers/        Specs, plans, reviews
```

## 开发验证

```bash
npm run build
npm test
npm run test:smoke
npm run ci:check
```

发布前建议：

```bash
npm run ci:check
git diff --check
npm audit --registry=https://registry.npmjs.org --audit-level=high
```

## 设计原则

- **Local-first**：有价值的状态留在本机，路径和边界可查看。
- **Slash-first**：本地控制面优先从 `/` 发现和执行。
- **Recoverable**：长任务必须能 checkpoint、resume、recap 和 inspect。
- **Honest boundaries**：不支持的云端能力必须明确说明，不伪装成功。
- **Terminal-native**：增强终端体验，但保持纯文本兼容和低依赖。

## License

MIT
