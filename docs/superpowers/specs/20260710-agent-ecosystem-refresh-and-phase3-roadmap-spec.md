# Spec: Agent 生态续调研与轻灵 Phase 3 路线

**日期**: 2026-07-10
**状态**: Accepted
**版本目标**: `1.x` 上的 Phase 3（Harness Lean + Skills + 编排）
**前置**: `20260709-agent-cli-competitive-analysis-and-v1-roadmap-spec.md`（1.0 对标与 Phase 1.1–2.1）
**实施计划**: `docs/superpowers/plans/20260710-phase3-harness-lean-skills-orchestration-plan.md`

---

## 1. 背景与目标

### 1.1 为何续调研

2026-07-09 的 1.0 对标覆盖了 OpenCode / Pi / Aider / Goose / Codex / Gemini CLI / OpenHands / Cline / Crush / Qwen Code，并规划 Phase 1.1–2.1。
CHANGELOG `v1.0.0` 显示 **Phase 1.1–2.0 主体已落地**（Provider、Plan Mode、git auto-commit、TUI、分发、写沙箱、eval:smoke、skills 模板、MCP presets、SDK）。

社区与 GitHub 在 2026-07 又强化了新共识：

1. **Harness 决定成本与质量**（同模型换 harness 成本可差 ~2×）
2. **Super Agent Harness** = sub-agents + memory + sandbox + progressive skills + IM gateway
3. **Skills 成为跨 harness 可移植层**
4. **Tokenmaxxing / 多模型编排** 优于绑定单一闭源 harness

本 spec 记录 2026-07-10 抓取的外部证据，冻结 **Phase 3** 差距与路线，避免在 1.0 后再做「功能清单追星」。

### 1.2 成功标准

1. 外部标杆列表与 20260709 **有明确 delta**（新增仓库 + 新共识）。
2. qling 差距用 H1–H10 编号，可映射到实施任务。
3. Phase 3 分期可执行，优先 **省 token / 可编排 / 可度量**。
4. 不削弱本地优先、中文控制面、mission/daemon、privacy/doctor 差异化。

---

## 2. 外部调研（2026-07-10）

### 2.1 社区共识（X + Databricks）

| 共识 | 证据摘要 | 对 qling 的含义 |
|------|----------|-----------------|
| Harness > 单模型排行 | Databricks 百万行内部基准：Pi 等精简 harness 同成功率、更低 $/task；上下文约 3× 更紧 | P0 做 Lean Context，而非再堆工具 |
| Super Agent Harness | DeerFlow 2.0：sub-agents、memory、sandbox、skills、message gateway | 长程 = 编排，不是更长 system prompt |
| Skills 生态 | addyosmani/agent-skills、CowAgent Skill Hub、DeerFlow skill 安全扫描 | 生命周期技能 + 安装扫描 |
| 外接内容不可信 | gemini-cli 相关供应链/Issue 注入讨论 | skill/外链默认扫描与权限 |

参考：

- https://www.databricks.com/blog/benchmarking-coding-agents-databricks-multi-million-line-codebase
- https://github.com/bytedance/deer-flow
- https://github.com/earendil-works/pi
- https://github.com/addyosmani/agent-skills

### 2.2 GitHub 标杆快照（stars 约值，2026-07-10 `gh api`）

#### A. 终端 coding harness（同赛道，1.0 已对标）

| 仓库 | Stars | 学习点 |
|------|------:|--------|
| anomalyco/opencode | ~184k | TUI/LSP/生态 |
| google-gemini/gemini-cli | ~106k | 上手与配额叙事 |
| openai/codex | ~97k | 轻量闭环、沙箱 |
| earendil-works/pi | ~69k | **精简 harness、上下文卫生** |
| code-yeongyu/oh-my-openagent | ~65k | tokenmaxx、Team Mode |
| cline/cline | ~65k | 审批 UX、SDK |
| openinterpreter/open-interpreter | ~64k | 开放模型友好 |
| aaif-goose/goose | ~51k | MCP 扩展 |
| Aider-AI/aider | ~47k | repo map、git、省 token |
| charmbracelet/crush | ~26k | TUI 质感 |
| QwenLM/qwen-code | ~26k | 中文/国内模型 |

#### B. 本轮新增或加重（1.0 文档未深挖）

| 仓库 | Stars | 可借能力 |
|------|------:|----------|
| browser-use/browser-use | ~104k | 可交互浏览器（非仅 fetch） |
| OpenHands/OpenHands | ~80k | 长程自治、评测 |
| bytedance/deer-flow | ~77k | progressive skills、sub-agents、sandbox 分级、IM、skill 扫描 |
| addyosmani/agent-skills | ~76k | `/spec`→`/ship` 生命周期 skills |
| shareAI-lab/learn-claude-code | ~71k | nano harness 教学；model+harness 叙事 |
| FoundationAgents/OpenManus | ~57k | 通用计划→执行 |
| zhayujie/CowAgent | ~46k | 中文多通道、记忆分层、Skill Hub |
| langchain-ai/deepagents | ~26k | batteries-included harness |
| kortix-ai/suna | ~20k | 组织指挥台形态 |
| agent0ai/agent-zero | ~18k | 动态造工具（谨慎） |
| HKUDS/OpenHarness | ~15k | 开放 harness 对照 |
| alejandrobalderas/claude-code-from-source | ~2.6k | 4 层压缩、并发工具、fork agents（教育） |
| ciembor/agent-rules-books | ~2.2k | 工程书蒸馏为 AGENTS 规则 |

#### C. 诚实边界

- 社交媒体「10 大仓库」列表常夸大 stars/用途；落地以 **可 clone README + 近期维护 + 可验证模式** 为准。
- qling（Zzy-min/qling）当前 stars 极少，**不**以追星为 KPI。

### 2.3 与 20260709 的 delta

| 类别 | 20260709 | 20260710 |
|------|----------|----------|
| 主叙事 | 功能矩阵追齐 1.0 契约 | **Harness 成本/上下文 + Skills 生态 + 子代理** |
| 新增必学 | — | DeerFlow、OmO、agent-skills、CowAgent、Databricks harness 结论 |
| 1.x 已落地 | Phase 1.1–2.0 规划中 | 多数已在 v1.0.0 完成 → 焦点转 Phase 3 |
| 仍开放 | G2 LSP、G7 评测、G8 生态、G10 分包 | 重编号为 H1–H10，优先级重排 |

---

## 3. qling 现状摘要（实现面）

| 能力域 | 现状 |
|--------|------|
| 运行模式 | chat / repl / run / continue / resume |
| Agent 内核 | AgentLoop + Pipeline + tools |
| 工具 | bash/read/write/patch/search/todo/skill/planner/url_fetch/browser_fetch/vision/subtask |
| 治理 | guard、审批、内容过滤、写沙箱、网络模式 |
| 记忆 | Scratchpad/Conversation/Persisted、WAL、可选语义 |
| Skills | 本地 MD；system 侧主要为 name+desc 索引；`skill` 工具按需加载正文 |
| 压缩 | ContextCompactor + skeletonize read 结果；工具结果可 trim |
| 后台 | mission + daemon |
| 通道 | console / Telegram / Slack |
| 评测 | eval:smoke（无 LLM） |
| 差异化 | 中文 UX、privacy/doctor/storage、可恢复长任务 |

---

## 4. Phase 3 差距（H1–H10）

| ID | 差距 | 对标 | 优先级 |
|----|------|------|--------|
| H1 | 工具结果与会话工作集仍偏胖 | Pi / Databricks / CC-from-source | **P0** |
| H2 | Skills 渐进协议不够硬（缺 triggers/扫描/安装） | DeerFlow / agent-skills | **P0** |
| H3 | subtask 单层、无角色工具子集契约 | DeerFlow / OmO | P1 |
| H4 | 工程生命周期技能薄 | addyosmani | **P0/P1** |
| H5 | 浏览器是抓取不是操作 | browser-use | P1 后置 |
| H6 | 缺任务级 harness 成本拆解 | Databricks | P0 随 H1 |
| H7 | IM 网关产品化不足 | DeerFlow / CowAgent | P2 |
| H8 | 无 LSP | OpenCode | Phase 4 |
| H9 | 评测仅 smoke | OpenHands | P1 |
| H10 | Skill 供应链几乎无扫描 | DeerFlow / 安全事件 | **P0** 随 H2 |

### 4.1 必须保留

- 本地优先与可解释边界
- 中文 slash / 顶层别名
- mission + daemon
- 规格驱动文档资产

### 4.2 明确不做（Phase 3）

- 完整 Desktop
- 默认云同步账号
- 克隆 OpenCode 全量 provider 目录
- Agent-Zero 式任意自造工具默认开启
- monorepo 分包（延后到 API 稳定）

---

## 5. Phase 3 产品定位

> **轻灵 Phase 3**：在 1.0 本地中文工作台契约上，把 harness 做成 **更省上下文、技能可渐进加载、子代理可编排、改动能用数字证明** 的执行层——不是更大的聊天框。

### 5.1 分期

| 阶段 | 名称 | 对应差距 |
|------|------|----------|
| 3.0 | Harness Lean | H1, H6 |
| 3.1 | Progressive Skills + 生命周期 + 扫描 | H2, H4, H10 |
| 3.2 | 角色化 Sub-agent | H3 |
| 3.3 | 浏览器/外联深度 | H5 |
| 3.4 | 评测扩展 | H9 |
| 3.5 | 通道深化 | H7 |

### 5.2 验收总原则

- 每个阶段有 **单元/smoke 测试** 与 **至少一条可复现本地证据**。
- Token 相关结论必须基于 **provider 官方 usage** 或显式标注的本地字符估计（不得混称账单）。
- 破坏性 CLI/slash 变更走 deprecation。

---

## 6. 详细需求（可实施）

### 6.1 Phase 3.0 — Harness Lean

1. **工具结果入上下文前卫生处理**
   - 对超长 `tool` 消息：保留头尾摘要 + 字节/行数元数据，中间折叠。
   - 默认阈值可配置（环境变量），不破坏 tool_call 链。
2. **压缩层可见**
   - `/context` 增加估计：history / tool-output / 其他 的本地字符或估计 token 占比。
3. **工作集策略（可渐进）**
   - 压缩时 recent 保护已有；进一步对「非活动文件」的旧 read 输出 skeletonize（已有基础则加固）。

### 6.2 Phase 3.1 — Progressive Skills

1. system 节 **仅索引**（name / description / tags / triggers），禁止注入正文。
2. 正文仅 `skill` 工具或 `/skill` 加载。
3. 官方中文生命周期 skills：`lifecycle-spec|plan|build|test|review|ship`（原创精简，不复制第三方版权正文）。
4. **静态安全扫描**：私钥模式、可疑 shell、外联 URL 等；安装/加载路径可报告。
5. `docs/skills.md` 更新协议与扫描说明。

### 6.3 Phase 3.2+（本 spec 定义边界，可分 PR）

- 角色：`explore`（只读）/ `implement` / `review`
- 回传：摘要 + 文件列表 + 证据，禁止整会话上浮
- eval 扩展 harness 指标
- 浏览器 act 默认关闭

---

## 7. 风险

| 风险 | 缓解 |
|------|------|
| 压缩过猛丢上下文 | `/context` 可见；保留 `/compact` 与 checkpoint；测试锁 tool chain |
| 追 DeerFlow 体积 | 只借协议，不引入 Python 全栈 |
| 恶意 skill | 默认扫描；用户目录安装可拒绝高危 |
| Windows 回归 | TUI/路径相关改动在 Windows 跑测试 |

---

## 8. 验收清单（本 spec 交付）

- [x] 2026-07-10 标杆与 X/Databricks 共识
- [x] 与 20260709 的 delta
- [x] H1–H10 与 Phase 3 分期
- [ ] 实施见配套 plan；代码分 PR 勾选

---

## 9. 参考链接

- https://github.com/anomalyco/opencode
- https://github.com/earendil-works/pi
- https://github.com/bytedance/deer-flow
- https://github.com/addyosmani/agent-skills
- https://github.com/code-yeongyu/oh-my-openagent
- https://github.com/zhayujie/CowAgent
- https://github.com/shareAI-lab/learn-claude-code
- https://github.com/alejandrobalderas/claude-code-from-source
- https://github.com/browser-use/browser-use
- https://www.databricks.com/blog/benchmarking-coding-agents-databricks-multi-million-line-codebase
- 本地：`docs/superpowers/specs/20260709-agent-cli-competitive-analysis-and-v1-roadmap-spec.md`
