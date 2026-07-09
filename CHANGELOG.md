# Changelog

## v1.0.0 (2026-07-09)

### Token 与预算

- **官方 usage 计数**：会话 token 仅累加模型 API 返回的 `prompt_tokens` / `completion_tokens` / `total_tokens`（及 Anthropic/Ollama 等价字段）；不再用字符×4 估算账单。
- **删除预算功能**：移除 `TokenBudgetManager`、预算 nudge、system prompt Token 预算节、`max_token_budget` 配置接线与百分比水位。
- **展示**：`/usage`、`/context`、statusline 显示 total/in/out 与 `provider|unknown` 来源。

### TUI 体验（结果聚焦）

- **输入区去噪**：输入框上方不再打印 statusline 与快捷键黑灰提示行；详情仍用 `/statusline`、`/shortcuts` 与顶栏。
- **结果高亮**：任务最终答复以「结果」边框强调；完成态改为醒目的「任务完成」+ 耗时。

### 发布收尾（发布就绪补丁）

- **跨平台 CI**：`write-sandbox` 单测改用 `path.resolve`/`tmpdir`，去掉硬编码 `C:\\` 路径。
- **`qling --version` / `-V` / `version`**：本地打印 `qling/<semver>`，不加载配置、不要求 API key。
- **版本单一来源**：`src/package-version.ts` 统一供 TUI、system prompt、daemon `/health`、help 使用。
- **干净构建**：`npm run clean` 删除 `dist/`；`build`/`prepack` 先 clean 再 `tsc`，避免陈旧产物进入 npm pack。
- **npm 包名**：因官方相似度策略改为 `@qlingzzy/qling`（`bin` 仍为 `qling`）；不可用无作用域名 `qling`。

### 稳定工作台契约

- **版本语义**：进入 `1.0.0`。表示本地优先的中文 AI Agent CLI 工作台核心契约可用且稳定，而非追平全部开源标杆的功能总量。
- **能力继承**：完整继承 v0.5.x 的 chat/repl/run、流式 TUI、MCP（stdio+HTTP）、guard 治理、记忆/WAL、mission+daemon、dashboard、browser_fetch、checkpoint/resume/export 等能力。
- **对标路线**：对照 OpenCode、Pi、Aider、Goose、Codex CLI、Gemini CLI、Cline、Crush、Qwen Code 等标杆，固化后续提升分期：
  - Phase 1.1 Provider / Ollama 一等公民
  - Phase 1.2 安全编辑 + git 策略 + plan 模式
  - Phase 1.3 TUI 产品化
  - Phase 1.4 安装分发与文档
  - Phase 1.5 沙箱与安全默认
  - Phase 2.x 评测、生态、分包
- **文档**：
  - Spec: `docs/superpowers/specs/20260709-agent-cli-competitive-analysis-and-v1-roadmap-spec.md`
  - Plan: `docs/superpowers/plans/20260709-v1.0.0-release-and-roadmap-plan.md`
- **兼容承诺**：顶层命令与 `/` slash 控制面以兼容优先；破坏性变更将走 deprecation 窗口并在 CHANGELOG 标明。

### Phase 1.1 — Provider 一等公民（同版本增量）

- **共享预设表** `src/providers/presets.ts`：setup 与 slash 命令同源（DeepSeek / 百炼 / 智谱 / Kimi / MiniMax / MiMo / SiliconFlow / OpenAI / Ollama）。
- **`/model` 增强**：
  - `/model` 显示 provider + endpoint + model
  - `/model list` 列出预设
  - `/model use <preset|序号>` 切换整包 LLM 配置（进程内，默认不写盘）
  - `/model <name>` 兼容仅切换 model
- **AgentLoop**：`getProvider` / `getEndpoint` / `applyLlmSession`；本地 loopback 允许空 API key。
- **`doctor`**：新增本机 Ollama 探测（仅 loopback，`QLING_OLLAMA_URL` 可覆盖）。

### Phase 1.2 — 编码闭环（同版本增量）

- **patch 增强**：空 search 拒绝、noop 检测、`dry_run` 预览 diff、行变更摘要、2MiB 大文件护栏。
- **Plan Mode**：`/plan on|off|status|<desc>`；会话级拒绝 write/patch/bash/subtask/browser_fetch。
- **Git auto-commit**：`QLING_GIT_AUTO_COMMIT=off|on|ask`（默认 off）；write/patch 成功后按策略提示或自动提交。

### Phase 1.3 — TUI 产品化（同版本增量）

- **Top bar**：显示 `Mode`（agent/plan）与 `Perm`。
- **Statusline**：增加 `模式=plan|agent`，并在 `showPrompt` 真正打印。
- **工具输出卡片**：`formatToolOutputCard` 统一折叠；stdout 批量写入减闪烁。
- **`/expand`**：与 Ctrl+O 同源切换长工具输出展开/折叠。

### Phase 1.4 — 分发与上手（同版本增量）

- **package.json**：engines / keywords / repository / homepage / bugs / files / license 等发布元数据。
- **README.en.md**：英文最小上手文档。
- **docs/install.md**：npm / git / Windows PowerShell / Scoop·winget 草案说明。
- **packaging/**：Scoop 与 winget 清单草稿（未上架）。
- **Onboarding**：结构化 3 步首次引导卡片（可测、非阻塞）。

### Phase 1.5 — 安全与沙箱（同版本增量）

- **写沙箱**：`QLING_WRITE_SANDBOX=workspace|roots|off`（默认 workspace）；write/patch 默认不可出工作区。
- **敏感写拦截**：默认拒绝 `.env*` / 密钥类文件；`QLING_ALLOW_SENSITIVE_WRITE=1` 可覆盖。
- **网络模式**：`QLING_GUARD_NETWORK_MODE=strict|open|deny`；`browser_fetch` 与 `url_fetch` 共用 Guard。
- **密钥扫描**：覆盖更多 `.env.*` 变体。
- **Docker 文档**：`docs/docker.md` + `packaging/docker/` 草案。

### Phase 2.0 — 评测 / Skills / MCP / SDK（同版本增量）

- **eval:smoke**：本地无 LLM 评测集（`npm run eval:smoke`），覆盖沙箱/网络/预设/Plan Mode 等。
- **Skills**：`skills/templates/SKILL.md` + `skills/examples/repo-triage`；`docs/skills.md`。
- **MCP**：`qling mcp presets|list|add|remove`；本机 store `~/.qling/mcp-servers.json`。
- **SDK**：`import { AgentLoop } from "@qlingzzy/qling"`（`src/sdk.ts` + package `exports`）；`docs/sdk.md`。

## v0.5.0 (2026-05-07)

### Phase F — Missions & Browser

- **Browser Fetch (v0.5)**: 集成 Playwright 支持 JS 渲染页面抓取
- **Mission Manager**: 引入长任务状态管理与持久化队列
- **Onboarding flow**: 交互式 `qling setup` 配置向导
- **Daemon Mode**: 后台守护进程支持（`npm run daemon`）
- **性能优化**: 优化了流式 TUI 的渲染抖动问题

## v0.4.0 (2026-05-05)

### Phase D-E — Connectivity & Quality

- **MCP HTTP Transport**: 支持基于 HTTP 的 Streamable MCP 服务器
- **E2E Testing Framework**: 引入 Fake LLM Server 与完整的工具链测试
- **Guard M2 增强**: 完善了内容过滤与权限矩阵的审计日志
- **文档补全**: 完成了完整的项目架构说明与工具手册

## v0.3.0 (2026-05-03)

### Phase 5, A, B — Production Ready

- **Channels**: 增加 Telegram 与 Slack 通道支持
- **Dashboard**: 内置 Web 观测台，可视化思考链路
- **Semantic Memory**: 基于 SQLite 的向量记忆索引
- **Dynamic Skills**: 支持从目录或 URL 动态加载技能
- **Approval Gate**: 引入工具调用审批流与超时拒绝机制

## v0.2.0 (2026-05-02)

### Phase 3-4 — Memory & MCP

- **Memory System**: 三层记忆架构（Scratchpad → Conversation → Persisted）
- **WAL Log**: 记忆追加日志与崩溃恢复机制
- **MCP Stdio Client**: 实现 JSON-RPC 2.0 协议的 MCP 客户端
- **Subtask**: 支持隔离的子任务执行逻辑

## v0.1.0 (2026-05-01)

### Phase 0-2 — Foundation & Stability

- 统一配置平面（CLI > ENV > config > defaults）
- 运行模式（run/chat/repl 子命令）
- Guard M1（URL 白名单、私网拦截、审计日志）
- 错误语义升级与统一
- 核心回归用例（Search/Compactor/Loop）
