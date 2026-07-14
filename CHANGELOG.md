# Changelog

## Unreleased

### Phase 7.0 — Sprint 4 分发与生态

- **`eval:tasks`**：10 个本地 repo fixture（修测试 / 改文案 / 加函数 / 重命名 / 修 import / package scripts / JSON / 文档节 / 多文件一致 / 中文路径），不依赖 LLM。
- **`validate:packaging`**：校验 Scoop / winget 草案版本与 `package.json` 对齐。
- **Scoop / winget 文档**：`docs/install.md` 与 `packaging/README.md` 补充本地校验步骤；清单版本钉到 1.1.0。
- **Skills 示例包**：`fix-failing-test` / `add-function` / `pr-summary` + `skills/examples/README.md`。
- **英文 README**：补齐 1.1 能力、eval、分发与 skills 说明。
- **Demo 说明**：`docs/demo.md`（文字演示路径；GIF 另录不入库）。
- **`ci:check`**：纳入 `eval:tasks` 与 `validate:packaging`。

## v1.1.0 (2026-07-14)

1.1 聚焦：**可证明的执行韧性**、**可维护的内核分层**、**编码/TUI 精度** 与 **Windows CI**。

### Highlights

- 执行韧性：确定性恢复策略、`/recover`、验证闭环、脱敏 trace、`eval:recovery`
- 架构：从 `agent-loop` 抽出 LLM 客户端、工具编排、主循环、system prompt、session 持久、验证闭环
- 编码精度：patch 原子写、repo-map/search 预算、工具输出折叠与 CJK 宽度
- CI：ubuntu 全量 + windows unit

### Phase 6.0 — Sprint 3 编码精度 / TUI / Windows CI

- **patch 原子写**：`writeFileAtomic`（temp + rename，Windows 回退直写），降低半截写入风险。
- **repo map 预算**：`buildRepoMapSection` 支持 `maxSymbols`/`maxChars`（默认 200 / 6000），超限截断并提示。
- **search 上下文卫生**：默认 limit 40；`truncateSearchLine` 截断过长匹配行。
- **TUI**：工具输出折叠 footer 中英双语；底部提示含 Shift+Tab / `/mode`；CJK `visibleWidth` 回归测试。
- **CI**：ubuntu 全量 `ci:check` + `windows-latest` 跑 unit（`npm run test`）。

### Phase 5.2 — 巨石拆分预备

- **LLM 客户端抽出**：`src/providers/llm-client.ts`（`LlmHttpClient`）
- **记忆 lifecycle 抽出**：`src/memory/lifecycle.ts` 的 `runAutoDream`
- **Dashboard 解耦**：对 `dashboard-server` 动态 import
- **工具编排抽出**：`src/agent/tool-orchestrator.ts`
- **验证闭环抽出**：`src/execution/verification-loop.ts` + `recovery-messages.ts`
- **Session 持久抽出**：`src/session/session-persistence.ts`
- **主循环 / system prompt 抽出**：`src/agent/main-loop.ts`、`src/agent/system-prompt.ts`

### Phase 5.1 — 验证闭环统一 + Doctor

- 写操作恢复只走 `StagedVerifier`；多阶段 env 配置
- Progress 含 `changedFiles` / 策略字段
- Doctor Phase5：`recovery_budget` / `run_traces` / `verifier_stages` / `verify_llm_advisory`
- Metrics：`pausedRuns`、`averageTimeToPauseMs`

### Phase 5.0 — 执行韧性收口

- `RecoveryStrategyPlanner` + 暂停动作语义
- TUI 订阅 execution events
- `eval:recovery` 扩充

### TUI / Dashboard / Phase 3–4（延续）

- Shift+Tab 模式循环、Slash 输入框修复、Dashboard 任务工作台
- Harness lean、progressive skills、角色 sub-agent、browser_act、LSP 可选等（详见下方历史与 v1.0.0）

### Phase 3.4 — Eval harness 指标（smoke 增量）

- `eval:smoke` 新增：工具输出折叠、explore 只读、回传契约、skill 扫描、角色别名等本地任务。

### Phase 3.3 — 浏览器 / 外联路由

- **`docs/web-routing.md`**：opencli / url_fetch / browser_fetch / browser_act 决策树。
- **`browser_act` 工具**：有限 goto/click/type/wait_for/extract/press；**默认关闭**（`QLING_BROWSER_ACT=1` 启用）；共用网络 Guard；Plan Mode 禁止。
- opencli skill 与 system Restrictions 同步分工说明。

### Phase 3.3.1 — browser_act 跨步会话

- **`session` 保活**：`open` / `close` / `status` + 同 session 上 click/type/extract。
- 空闲回收：`QLING_BROWSER_ACT_IDLE_TTL_MS`（默认 10min）；上限 `QLING_BROWSER_ACT_MAX_SESSIONS`（默认 3）。
- 模块：`src/tools/browser-act-session.ts`。

### Phase 3.2.1 — explore 并行（默认关）

- `subtask tasks=["…","…"]` + `role=explore|review`，须 `QLING_SUBTASK_PARALLEL=1`。
- implement 禁止并行；上限 `QLING_SUBTASK_PARALLEL_MAX`（默认 3）。
- 模块：`src/agent/subtask-parallel.ts`。

### Phase 3.5 — Mission 进度通知

- 使命状态变更可推送 Telegram / Slack（需已配置 channel token + chat/channel id）。
- `QLING_MISSION_NOTIFY=off` 可关；`QLING_MISSION_TELEGRAM_CHAT_ID` / `QLING_MISSION_SLACK_CHANNEL_ID` 可选覆盖。

### Phase 3.5.1 — 通知结构化卡片

- 默认 `QLING_MISSION_NOTIFY_STYLE=rich`：Telegram HTML、Slack Block Kit；`plain` 回退纯文本。
- 状态 emoji 前缀；失败带错误摘要。

### Phase 3.5.2 — 使命日志推送 + Doctor Phase3

- **日志推送**：`appendLog` 可推送通道；`QLING_MISSION_NOTIFY_LOGS=off|milestone|all`（默认 milestone）。
- **`qling doctor`**：展示 browser_act / subtask_parallel / mission_notify 开关摘要。
- **可选 e2e**：`QLING_BROWSER_ACT_E2E=1` + `QLING_BROWSER_ACT=1` 跑真实 Playwright 冒烟（默认 skip）。

### Phase 4.0–4.2 — 路线 + LLM eval + code_symbols

- **路线**：`docs/superpowers/specs/20260710-phase4-capability-roadmap-spec.md`
- **可选 LLM 评测**：`npm run eval:llm`（需 `QLING_EVAL_LLM=1` + API key；默认 skip，不进 ci:check）
- **工具 `code_symbols`**：工作区符号名检索（静态提取，非完整 LSP）；explore/implement/review 可用
- eval:smoke 增加 code_symbols 本地任务

### Phase 4.3 — 可选 TypeScript 语义查询（lsp）

- **工具 `lsp`**：`definition` / `hover` / `references` / `document_symbols`
- **默认关闭**：`QLING_LSP=1` 启用；动态加载 `typescript`（缺包时明确报错）
- 进程内 LanguageService（非 stdio 多语言 LSP 协议）；`doctor` 展示 phase4:lsp
- 通用符号扫描仍用 `code_symbols`

### Phase 4.4 — 模块分层与包边界

- **文档**：`docs/architecture-layers.md`（目标分层、禁止边、拆包门槛）
- **扫描**：`npm run dep:layers` → `scripts/dep-layers.mjs`（`--json` / `--write-doc` / `--strict`）
- **诚实债务**：记录 adapters→cli、eval/runtime 等反向依赖；strict 暂不进 ci:check

### 审计收尾 — 本地优先与恢复边界

- Memory Dream LLM 改为仅在 `QLING_MEMORY_DREAM_LLM_ENABLED=true|1|on|yes` 时启用，SDK 直接构造默认不额外调用模型。
- 远程 discovery 默认拒绝未签名清单，并接入 network Guard、禁止自动重定向、限制 1 MiB 响应；需审批 source 在无审批回调时 fail-closed。
- Discovery 工具清单与运行时可执行工具分离，未绑定 handler/MCP transport 的 metadata 不再向模型宣称可调用。
- Workflow checkpoint 持久化状态机定义，恢复后迁移继续有效；非法 `runId` 和缺失定义的旧 checkpoint 明确拒绝。
- `browser_act` 在创建会话前完成 URL Guard 检查，拒绝目标不再留下空白 Playwright 会话。

## v1.0.0 (2026-07-09)

### opencli 小红书路由补强

- skill `opencli` 增加小红书专节：`note`/`comments` 必须使用含 `xsec_token` 的完整 URL（禁止裸 note-id）。
- Restrictions 同步提示 xiaohongshu 正确传参。

### Agent 任务执行基本规则

- 常驻 system prompt（Workflow / Restrictions / Tone）固化三条规则：
  1. 调用外部工具前先做工具与任务的关联分析
  2. 成功后总结正确可复现流程
  3. 单流程失败或未准确执行时实事求是承认

### Agent 路由（opencli）

- **内置 skill `opencli`**：教模型用 `bash` + `opencli <site> … -f json` 获取平台数据；明确抖音≠TikTok、禁止 `url_fetch` 强反爬站。
- **system prompt 短路由**：Restrictions 中写入网页/社交平台调用规则。
- **skill 扫描路径**：包内 `skills/` + `~/.qling/skills/` + 工作区 skills，全局安装后仍能加载内置 skill。

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
