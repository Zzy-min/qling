# 轻灵 Qling

本地优先的 AI Agent CLI。轻灵把 Claude Code 风格的终端交互、slash command、会话恢复、任务编排、权限边界、上下文可视化和本地记忆放进一个可自托管的 Node.js/TypeScript CLI。

核心目标很明确：顺滑交互、稳定执行、数据留在本机。

## Highlights

- **Claude Code 风格 TUI**：顶部状态栏、角色块、工具执行时间线、结果框和完整输入框。
- **Slash-first 交互**：输入 `/` 打开命令面板，支持过滤、参数提示、`↑/↓` 选择、`Tab` 补全、`Enter` 执行当前输入。
- **完整本地命令面**：`/model`、`/plan`、`/usage`、`/diff`、`/copy`、`/init`、`/rewind`、`/checkpoint`、`/sessions`、`/resume`、`/permissions`、`/context` 等。
- **本地 Skill 直达**：支持 `/skill list`、`/skill search <query>`、`/skill <name>`，也支持直接 `/<skill-name>` 调用本地 `skills/` 或 `.qling/skills/` 中的 Markdown skill。
- **Local-first 安全边界**：会话、记忆、导出、任务、诊断默认写入本地 state；Claude 账号/云端/桌面/移动端专属命令只显示边界说明，不伪装成功。
- **会话与上下文恢复**：`/checkpoint`、`/resume`、`--continue`、`--resume <session>` 支持中断后继续。
- **任务与目标推进**：`/goal`、`/loop`、`/tasks`、`/agents`、`/mission` 支持本地长任务和后台任务管理。
- **内置治理**：权限策略、内容过滤、速率限制、密钥脱敏、MCP 配置摘要和本地诊断。

## Quick Start

### Requirements

- Node.js >= 18
- npm >= 9
- Optional: Playwright Chromium, used by `browser_fetch`

### Install

```bash
git clone https://github.com/Zzy-min/qling.git
cd qling
npm install
npm run build
```

Optional browser support:

```bash
npx playwright install chromium
```

Optional global command:

```bash
npm link
qling
```

## Configure

Use the interactive setup:

```bash
qling setup
```

Or create `.env` manually:

```bash
cp .env.example .env
```

Common variables:

```bash
DEEPSEEK_API_KEY=sk-...
QLING_LLM_PROVIDER=deepseek
QLING_LLM_ENDPOINT=https://api.deepseek.com
QLING_LLM_MODEL=deepseek-chat
```

OpenAI-compatible providers are supported through `QLING_LLM_ENDPOINT`, `QLING_LLM_MODEL`, and the matching API key environment variable.

## Run

```bash
qling                         # default: streaming TUI
qling chat                    # explicit TUI
qling repl                    # simple REPL
qling run "analyze this repo" # one-shot execution
qling --continue              # restore latest interactive session
qling --resume <session>      # restore a specific session
```

npm script equivalents:

```bash
npm run tui
npm run repl
npm run exec -- "analyze this repo"
```

## Slash Commands

Inside the TUI, type `/` to open the command panel. Type a prefix such as `/mo`, use `↑/↓` to move selection, `Tab` to complete, and `Enter` to execute the text currently in the input box.

High-value local commands:

| Command | Purpose |
|---|---|
| `/help [topic]` | Show all slash commands or focused help. |
| `/model [model]` | Show or switch the current session model. Does not write config. |
| `/plan [description]` | Queue a normal planning prompt in the current conversation. |
| `/usage`, `/cost`, `/stats` | Show token source, token count, context budget, and compactions. |
| `/diff` | Read-only Git status and diff summary. |
| `/copy [N]` | Copy the Nth latest assistant reply to the clipboard. |
| `/init [--force]` | Create a local `AGENTS.md` project guide. Refuses overwrite by default. |
| `/skill`, `/skill list` | List local skills. |
| `/skill search <query>` | Search local skills by name, description, or tag. |
| `/skill <name>` or `/<skill-name>` | Read a local skill Markdown file. Built-in commands take priority. |
| `/checkpoint [name] [--force]` | Save a local recovery point. |
| `/sessions` | List saved sessions. |
| `/resume [session|latest]` | Restore a saved session. |
| `/rewind`, `/undo` | Show recoverable sessions and next recovery command. |
| `/clear`, `/reset`, `/new` | Reset the current conversation. |
| `/compact` | Manually compact context. |
| `/context` | Show local context and token usage. |
| `/privacy` | Show local data retention paths and boundaries. |
| `/permissions [status|allow|deny|ask]` | Show or switch local tool permission default. |
| `/permissions explain <tool>` | Explain a local permission decision. |
| `/statusline [on|off]` | Show or toggle the prompt status line. |
| `/goal [status|set <condition>|clear]` | Manage session goals. |
| `/loop [interval] [prompt]` | Create a repeated local prompt task. |
| `/tasks [cancel <id>|clear]` | Show or manage local loop tasks. |
| `/agents` | Show local background mission groups. |
| `/mission ...` | Manage local missions. |
| `/memory ...` | Inspect local memory, sources, practices, graph, or detail. |
| `/dream [count]` | Distill current conversation signals into local memory. |
| `/distill [count]` | Show local distilled practices. |
| `/export` | Export the current session as local Markdown. |
| `/exports [count]` | List local Markdown exports. |
| `/doctor` | Run local diagnostics. |
| `/config` | Show effective config with secrets redacted. |
| `/mcp` | Show local MCP server config summary. |
| `/hooks` | Show hooks and guard config summary. |
| `/shortcuts` | Show TUI key bindings. |

Claude account, desktop, mobile, cloud routine, GitHub App, and other platform-specific command names are discoverable for compatibility. They return a local boundary message and do not call a model, open a network connection, or pretend to complete a cloud action.

## TUI Shortcuts

| Key | Behavior |
|---|---|
| `Enter` | Send current input. |
| `Ctrl+C` | Clear non-empty draft; press twice on empty input to exit. |
| `Ctrl+Z` | Restore draft cleared by `Ctrl+C`. |
| `Ctrl+D` | Exit only when input is empty. |
| `Ctrl+L` | Clear and redraw the screen. |
| `Ctrl+O` | Toggle future long tool output expansion. |
| `Ctrl+R` | Search local input history. |
| `Ctrl+N` | Insert newline. |
| `Tab` | Empty input opens `/agents`; slash prefix completes selected command. |
| `↑/↓` | In slash panel, move selection; otherwise navigate input history. |

## Built-in Tools

| Tool | Purpose |
|---|---|
| `bash` | Execute shell commands through the guarded tool pipeline. |
| `read` | Read local files with size and binary guards. |
| `write` | Write local files. |
| `search` | Search local files and content. |
| `planner` | Create structured task plans. |
| `skill` | Load local Markdown skills. |
| `todo` | Manage a local task list. |
| `url_fetch` | Fetch allowed remote URLs with guard policy. |
| `browser_fetch` | Fetch browser-rendered pages through Playwright. |
| `subtask` | Run isolated subtask agents. |
| `vision_analyze` | Analyze local images with configured vision provider. |

## Local Data

Default runtime state is stored under the local qling state directory. Typical data includes:

- saved sessions
- checkpoints
- exports
- memory indexes
- session goals
- loop tasks
- mission metadata
- guard and diagnostics artifacts

Use these commands to inspect local boundaries:

```bash
qling privacy
qling storage
qling doctor
```

Inside the TUI:

```text
/privacy
/storage
/doctor
/context
```

## Project Layout

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

## Development

```bash
npm run build
npm test
npm run test:smoke
npm run ci:check
```

Useful release gate:

```bash
npm run ci:check
git diff --check
npm audit --registry=https://registry.npmjs.org --audit-level=high
```

## Design Principles

- **Local-first**: persist useful state locally and make storage paths visible.
- **Slash-first**: every local control surface should be discoverable from `/`.
- **Recoverable**: long work should support checkpoint, resume, recap, and context inspection.
- **Honest boundaries**: unsupported cloud-only commands must say so explicitly.
- **Low dependency TUI**: improve the terminal experience without requiring a full-screen app or heavy renderer.

## License

MIT
