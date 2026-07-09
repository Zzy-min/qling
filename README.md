# 轻灵 Qling

[![Node](https://img.shields.io/badge/Node-%E2%89%A518-339933?logo=node.js&logoColor=white)](#环境要求)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.0-orange.svg)](CHANGELOG.md)

[English](README.en.md) · [安装指南](docs/install.md) · [CHANGELOG](CHANGELOG.md)

轻灵（qling）是一个本地优先的 AI Agent CLI。它把会话、上下文、工具执行、skill、任务、权限、诊断、后台使命、观测台和恢复能力收拢到一个可审计、可中断、可继续的命令行界面里——不是 Claude Code 的复制品，而是一个面向中文开发者和本机工作流的终端控制台。

> 一句话：轻灵让 Agent 像一个本地工作台，而不是一个黑盒聊天窗口。

## 为什么是轻灵

| 维度 | 轻灵的做法 |
|---|---|
| 本地优先 | 会话、checkpoint、导出、记忆、任务、诊断默认落在本机；`qling privacy` 直接查看边界。 |
| 中文可用 | TUI、帮助、状态提示、命令别名（`帮助` / `使命` / `代理`）面向中文终端。 |
| Slash 控制面 | `/` 打开命令面板，过滤、参数提示、方向键选择、`Tab` 补全都在当前输入框内完成。 |
| 可恢复长任务 | `/checkpoint`、`/resume`、`/rewind`、`--continue`、`qling workflow resume` 让中断后的上下文可以接上。 |
| 本地 skill | `skills/` 与 `.qling/skills/` 中的 Markdown skill 可被 `/skill` 或 `/<skill-name>` 直接读取；内置命令优先级高于 skill。 |
| 后台使命 | `qling daemon` + `qling mission` 提供长任务状态机、暂停 / 恢复 / 重试 / attach。 |
| 观测台 | `qling dashboard start` 打开本地白盒化观测控制台，串起 thinking / tool / token 链路。 |
| 通道与扩展 | `src/channels/` 内置 console / Telegram / Slack 通道；`qling discovery sync` 动态同步插件与技能。 |
| 权限可解释 | `/permissions`、`/permissions explain <tool>`、guard、内容过滤、速率限制和密钥脱敏都以本地规则呈现。 |
| 上下文透明 | `/context`、`/usage` 显示 token 来源、估算、上下文预算和压缩状态。 |
| 诊断内建 | `/doctor`、`/config`、`/mcp`、`/hooks`、`/diff` 用于快速判断当前项目和运行时状态。 |
| 诚实边界 | 平台专属命令会被识别并给出本地边界说明，不会伪装成功。 |

## 快速开始

完整安装路径（Windows Scoop/winget 草案、卸载、原生模块注意）：见 **[docs/install.md](docs/install.md)**。

### 环境要求

- Node.js ≥ 18
- npm ≥ 9
- 可选：Playwright Chromium，用于 `browser_fetch` 工具（v0.5 已集成）

### 一键本机启动（推荐）

```bash
git clone https://github.com/Zzy-min/qling.git
cd qling
npm run bootstrap
```

需要浏览器抓取能力时：

```bash
npm run bootstrap -- --with-browser
```

`bootstrap` 会检查 Node/npm、安装依赖、构建项目、创建本地 `~/.qling/` 目录并给出 `doctor`/`setup` 下一步。默认不安装浏览器依赖，也不自动开启 dashboard、semantic memory、dynamic discovery。

### 全局命令

```bash
# 源码目录内
npm link
qling

# 或从 GitHub 直接全局安装
npm install -g github:Zzy-min/qling

# npm 发布后
# npm install -g qling
```

已安装 CLI 后，可运行本机初始化检查：

```bash
qling bootstrap
qling bootstrap --with-browser
qling bootstrap --profile dev
```

### 手动安装

```bash
npm install
npm run build
npm link   # 可选
```

### 最小配置

**强烈建议**：永远不要把 API key 直接写到可被同步、备份或分享的运行时文件（包括项目根 `.env` 或 `~/.qling/.env`）。

推荐做法：
- 使用系统用户环境变量（Windows: 设置 → 环境变量，或 PowerShell `$env:DEEPSEEK_API_KEY=...` 并持久化）。
- 或运行 `qling setup` 由交互引导配置。

如果必须使用文件，仅在**项目本地** `.env` 且已加入 `.gitignore`。运行时 `~/.qling/.env` 主要用于非敏感 provider/model 配置。

示例（仅演示，实际请勿提交）：
```bash
QLING_LLM_PROVIDER=deepseek
QLING_LLM_ENDPOINT=https://api.deepseek.com
QLING_LLM_MODEL=deepseek-chat
# API key 请通过系统环境变量或 qling setup 提供
```

或者直接走交互式向导：

```bash
qling setup
```

`qling setup` 默认走快速路径：Provider、Model、API key。Dashboard、语义记忆、动态技能发现等能力在 Advanced 分支中显式开启。

轻灵支持任意 OpenAI 兼容 provider；通过 `QLING_LLM_ENDPOINT` / `QLING_LLM_MODEL` + 对应 API key 环境变量接入。

> 使用 `/doctor`、`/privacy`、`bootstrap` 时会主动检测运行时 .env 中的明文密钥变量（仅报告名称和路径）。

### 跑通 4 个命令

```bash
qling                   # 默认进入流式 TUI（chat）
qling chat              # 显式进入流式 TUI
qling run "分析这个仓库" # 单次执行，推荐形式
qling bootstrap         # 本机初始化检查
qling setup             # 交互式配置 LLM 提供商
```

## 运行模式

| 模式 | 用途 |
|---|---|
| `qling` | 默认进入流式 TUI，等价于 `qling chat`。 |
| `qling chat` | 显式进入流式 TUI。 |
| `qling repl` | 简易 REPL，无 TUI 装饰。 |
| `qling run "任务"` | 单次执行后退出，适合脚本调用。 |
| `qling bootstrap` | 本机初始化检查、配置提示和 doctor 验证。 |
| `qling --continue` | 恢复最近一次交互会话。 |
| `qling --resume <session>` | 恢复指定交互会话。 |
| `qling daemon start` | 启动后台守护进程（qlingd）。 |
| `qling workflow resume <id>` | 从状态机 Checkpoint 恢复执行。 |
| `qling dashboard start` | 启动本地观测台。 |

向后兼容：`qling --tui`、`qling --repl`、`qling --once "task"`、直接以裸任务作为位置参数仍可用，但会有 warning。

## CLI 顶层命令

`qling help` 总是最新基线。常见命令：

```bash
# 状态 / 诊断 / 隐私
qling status            # 本地状态摘要
qling doctor            # 稳定性与数据留存诊断
qling privacy           # 数据留存路径与隐私边界
qling storage           # 只读盘点 state / sessions / exports / cache
qling context           # 本地上下文与快照状态
qling recap [session|latest] [count]   # 已保存会话的回顾

# 会话与恢复
qling sessions [count]          # 本地保存的会话快照
qling checkpoint [name]         # 复制最近会话为本地恢复检查点
qling exports [count]           # 本地 Markdown 会话导出
qling workflow resume <id>      # 从状态机 checkpoint 恢复

# 后台使命（v0.5）
qling mission start "任务"      # 开启一个后台使命
qling mission list              # 列出所有使命
qling mission show <id>         # 查看详情
qling mission logs <id>         # 查看日志
qling mission attach <id>       # 跟随使命输出直到结束
qling mission pause|resume|cancel|retry <id>

# 后台守护进程
qling daemon start|status|stop

# 观测 / 同步 / 记忆
qling dashboard start           # 本地白盒化观测台
qling discovery sync            # 动态同步插件与技能
qling memory status|list|search|sources|practices|graph|show|reindex

# 本地任务 / 目标 / 配置
qling tasks list [count] | cancel <id>
qling goal status|set|clear
qling permissions [explain <tool>]
qling config                    # 密钥脱敏后的有效配置
qling mcp                       # MCP server 摘要
qling hooks                     # hooks / guard 摘要
qling shortcuts                 # TUI 快捷键
qling statusline                # 输入区状态线
```

中文别名（部分示例）：

```bash
qling 帮助        # help
qling 诊断        # doctor
qling 状态        # status
qling 代理        # agents
qling 使命 列表   # mission list
qling 日志 <id>   # logs <id>
```

## TUI 内 slash 命令

进入 TUI（`qling` 或 `qling chat`）后，按 `/` 打开命令面板。输入前缀过滤候选，`↑/↓` 移动选择，`Tab` 接受候选并保留尾随空格，`Enter` 执行当前输入。

### 会话与恢复

| Command | Purpose |
|---|---|
| `/checkpoint [name] [--force]` | 保存本地恢复点。 |
| `/sessions` | 列出已保存会话。 |
| `/resume [session\|latest]` | 恢复指定或最近会话。 |
| `/rewind`, `/undo` | 显示可恢复点和下一步恢复命令；不自动回滚代码。 |
| `/clear`, `/reset`, `/new` | 清空当前对话上下文。 |
| `/compact` | 手动压缩上下文。 |
| `/export` | 将当前会话导出为本地 Markdown。 |
| `/exports [count]` | 查看最近导出。 |

### 模型、上下文与用量

| Command | Purpose |
|---|---|
| `/model [model]` | 显示或切换当前 session 模型；不写入配置文件。 |
| `/usage`, `/cost`, `/stats` | token 来源、用量、上下文预算和压缩状态。 |
| `/context` | 本地上下文和 token 使用情况。 |
| `/statusline [on\|off]` | 显示或切换输入区状态线。 |

### 工作推进

| Command | Purpose |
|---|---|
| `/plan [description]` | 在当前会话中排入普通计划请求。 |
| `/goal [status\|set <condition>\|clear]` | 管理当前 session 目标。 |
| `/loop [interval] [prompt]` | 创建本地重复提示任务。 |
| `/tasks [cancel <id>\|clear]` | 查看或管理本地 loop 任务。 |
| `/agents` | 查看本地后台使命分组。 |
| `/mission ...` | 管理本地使命。 |

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

| Tool | 来源 | 用途 |
|---|---|---|
| `bash` | `src/tools/bash.ts` | 通过 guard 管线执行 shell 命令。 |
| `read` | `src/tools/read.ts` | 读取本地文件，带大小和二进制保护。 |
| `write` | `src/tools/write.ts` | 写入本地文件。 |
| `search` | `src/tools/search.ts` | 搜索本地文件和内容。 |
| `planner` | `src/tools/planner.ts` | 生成结构化任务计划。 |
| `skill` | `src/tools/skill.ts` | 加载本地 Markdown skills。 |
| `todo` | `src/tools/todo.ts` | 管理本地任务列表。 |
| `url-fetch` | `src/tools/url-fetch.ts` | guard 策略下抓取允许的远程 URL。 |
| `browser-fetch` | `src/tools/browser-fetch.ts` | 通过 Playwright 抓取浏览器渲染页面（v0.5）。 |
| `subtask` | `src/tools/subtask.ts` | 运行隔离子任务 agent。 |
| `vision-analyze` | `src/tools/vision-analyze.ts` | 使用配置的视觉 provider 分析本地图片。 |

## 使命（Mission）后台任务

使命是轻灵在 v0.5 引入的后台任务模型。`qling daemon` 启动 qlingd 后：

- `qling mission start "..."` 把任务交给守护进程，关闭终端也能继续。
- 守护进程挂了或者没起时，CLI 自动回退到本地文件状态机上继续。
- `qling mission attach <id>` 以只读模式跟随使命输出。
- `/agents` / `qling agents` / `qling 代理` 按状态分组查看。

完整命令：

```bash
qling mission start "任务"      # 提交到 qlingd
qling mission list              # 列出
qling mission show <id>         # 详情
qling mission logs <id>         # 日志
qling mission attach <id>       # 跟随输出
qling mission pause|resume|cancel|retry <id>
qling mission stop|terminate <id>   # cancel 的别名
qling mission respawn <id>          # retry 的别名
```

## 本地数据边界

轻灵默认把运行态数据写入 `~/.qling/`（可被 `--file-state-dir` 覆盖），常见内容：

- saved sessions
- checkpoints
- exports
- memory indexes（SQLite + 向量）
- session goals
- loop tasks
- mission metadata
- guard / 审计 artifacts
- 通道状态（Telegram / Slack）

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
  agent-loop.ts          Agent 主循环与模型 / 工具编排
  agent/                 隔离子任务 agent
  channels/              控制台 / Telegram / Slack 通道
  cli/                   CLI 启动契约 + setup + daemon 控制
  commands/              slash 命令实现
  daemon.ts              qlingd 后台守护进程入口
  dashboard-server.ts    本地观测 HTTP 服务
  discovery-*.ts         动态插件 / 技能注册
  guard/                 权限、内容过滤、审计
  mcp/                   MCP stdio + HTTP 客户端
  memory/                WAL / 投影 / 语义记忆
  mission/               使命状态机
  pipeline/              prompt section / hooks / 验证
  session/               会话注册 / goal / task / scheduler
  skills/                本地 skill 注册
  tools/                 内置工具实现
  tui/                   流式终端 UI
tests/
  unit/                  单元测试
  smoke/                 端到端冒烟测试
docs/superpowers/        specs / plans / reviews
```

## 开发与验证

```bash
npm run build         # tsc
npm test              # 单元测试
npm run test:smoke    # 端到端冒烟
npm run ci:check      # build + unit + smoke
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

## 版本与变更

- 当前版本：`1.0.0`
- 完整变更历史：见 [CHANGELOG.md](CHANGELOG.md)
- 安装与分发：见 [docs/install.md](docs/install.md)、[packaging/](packaging/)
- Skills：见 [docs/skills.md](docs/skills.md)
- SDK：见 [docs/sdk.md](docs/sdk.md)
- 本地评测：`npm run eval:smoke`
- 英文说明：见 [README.en.md](README.en.md)
- 竞品对标与提升路线：见 `docs/superpowers/specs/20260709-agent-cli-competitive-analysis-and-v1-roadmap-spec.md`
- 设计 / 实施文档：见 `docs/superpowers/specs/`、`docs/superpowers/plans/`

## License

[MIT](LICENSE)
