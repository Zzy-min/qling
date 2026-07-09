# Spec: Agent CLI 竞品对标与轻灵 Qling 1.0 提升路线

**日期**: 2026-07-09  
**状态**: Accepted  
**版本目标**: `1.0.0`  
**范围**: 外部标杆调研 → 本地能力差距 → 可执行提升方案（非一次性重写）

---

## 1. 背景与目标

### 1.1 本地项目现状（qling）

轻灵（`qling`）是**本地优先、中文优先**的 AI Agent CLI 工作台，当前实现面已覆盖：

| 能力域 | 现状摘要 |
|--------|----------|
| 运行模式 | `chat` / `repl` / `run` / `--continue` / `--resume` |
| Agent 内核 | `AgentLoop` + Pipeline sections/hooks + 工具分发 |
| 工具 | bash / read / write / patch / search / todo / skill / planner / url_fetch / browser_fetch / vision / subtask |
| 治理 | guard 权限矩阵、审批门、内容过滤、速率限制、审计 |
| 记忆 | Scratchpad → Conversation → Persisted；WAL；语义索引（可选） |
| MCP | stdio + HTTP Streamable 客户端 |
| 会话恢复 | checkpoint / resume / export / recap / workflow resume |
| 后台 | daemon + mission 状态机 |
| 观测 | 本地 dashboard、metrics/telemetry、doctor |
| 通道 | console / Telegram / Slack |
| UX | 流式 TUI、中文 slash 别名、帮助/状态/权限可解释 |
| 测试 | unit ~77 + smoke ~20；`ci:check` |

版本起点：`0.5.0`（Phase F：Missions & Browser）。  
**本 spec 将产品版本号定义为 1.0.0，并给出对标后的演进路线。**

### 1.2 成功标准

1. **对标清晰**：选出可学习的开源 Agent CLI 标杆，并给出可操作差异点。  
2. **差异诚实**：不把「功能清单齐全」等同于「用户可感知质量」；明确 qling 的独特价值。  
3. **路线可执行**：按 P0/P1/P2 分期，每项含目标、参考对象、验收标准。  
4. **1.0 语义明确**：1.0 表示「核心工作台契约稳定、可日常使用」，而非「已追平 OpenCode 星标生态」。

---

## 2. 外部调研来源

### 2.1 GitHub 高相关仓库（2026-07-09 抓取）

| 仓库 | Stars（约） | 语言 | 定位 | 对 qling 的学习价值 |
|------|-------------|------|------|---------------------|
| [anomalyco/opencode](https://github.com/anomalyco/opencode) | ~184k | TS | 开源 coding agent 事实标准；多端（TUI/IDE/Desktop）；LSP；多模型 | **TUI 打磨、安装分发、双 Agent 模式、LSP、生态** |
| [google-gemini/gemini-cli] | ~106k | TS | Google 官方终端 Agent；免费额度；MCP | **入门体验、配额/免费路径、产品化文档** |
| [openai/codex](https://github.com/openai/codex) | ~96k | Rust | 官方轻量终端 coding agent | **任务完成效率、安全沙箱、token 效率** |
| [OpenHands/OpenHands](https://github.com/OpenHands/OpenHands) | ~80k | Python | 全自主开发 Agent 平台 | **长程自治、沙箱执行、评测与基准** |
| [earendil-works/pi](https://github.com/earendil-works/pi) | ~69k | TS | 模块化 agent harness（ai / agent-core / coding-agent / tui） | **包架构拆分、可扩展 harness、差分渲染 TUI** |
| [cline/cline](https://github.com/cline/cline) | ~64k | TS | SDK + IDE + CLI；审批优先 | **人机审批 UX、可嵌入 SDK** |
| [aaif-goose/goose](https://github.com/aaif-goose/goose)（Block Goose） | ~51k | Rust | 可扩展 Agent + 原生 MCP | **扩展模型、企业集成、MCP 深度** |
| [Aider-AI/aider](https://github.com/Aider-AI/aider) | ~47k | Python | 终端 pair programming 元老；git 原子提交 | **repo map、git 工作流、token 经济性** |
| [charmbracelet/crush](https://github.com/charmbracelet/crush) | ~26k | Go | 高颜值 agentic coding TUI | **终端美学与交互质感** |
| [QwenLM/qwen-code](https://github.com/QwenLM/qwen-code) | ~26k | TS | 通义系开源终端 coding agent | **中文场景、国内模型接入默认体验** |

补充（GitHub 搜索中出现的轻量/垂直标杆，星数较低但方向相关）：

- `getkimchi/kimchi` — 多模型编排终端 agent  
- `rokoss21/iosm-cli` — checkpoint / orchestration / extensions  
- `funAgent/build-claude-code-cli` — Claude Code 架构拆解课  
- `lupin4/wintermolt` — 单二进制 Zig 重写路线（安装体积极简）

### 2.2 X（Twitter）社区共识（2026 讨论摘要）

社区反复提到的「终端 Agent CLI 组合」：

1. **OpenCode** — 开源默认选项；多模型 / 本地模型 / 抛光 TUI  
2. **Claude Code** — 复杂架构与多文件改动的质量标杆（闭源）  
3. **Codex CLI** — token 效率与任务吞吐  
4. **Aider** — git 原生、省 token  
5. **Cline** — 审批门与 IDE 协同  
6. **Goose** — MCP 扩展与本地优先企业向  
7. **Gemini CLI** — 免费入口与低门槛

共性期望（社区话术提炼）：

- 多 provider / BYOK / 本地模型  
- 可中断、可恢复、可审计  
- 不强绑单一云  
- 终端体验「像产品」而不是「像 demo」  
- 扩展（MCP / Skills / Hooks）成为标配

---

## 3. 能力维度对比矩阵

评分说明：`●` 强 / `◐` 有但未成体系 / `○` 弱或缺失。  
qling 评分基于当前仓库代码与 README（非营销材料）。

| 维度 | OpenCode | Pi | Aider | Goose | Codex | Gemini CLI | **qling** |
|------|----------|-----|-------|-------|-------|------------|-----------|
| 流式 TUI 打磨 | ● | ● | ◐ | ◐ | ● | ● | ◐→●（有基础，差一致性） |
| 多模型 / Provider 抽象 | ● | ● | ● | ● | ○（OpenAI 系） | ○（Gemini） | ◐（OpenAI 兼容 + env） |
| 本地模型（Ollama 等） | ● | ● | ● | ● | ○ | ○ | ○（需显式 endpoint） |
| LSP / 语义编辑 | ● | ◐ | ◐ | ○ | ◐ | ◐ | ○ |
| Repo map / 代码索引 | ● | ◐ | ● | ◐ | ● | ● | ◐（有 repomap section） |
| Git 原生工作流 | ◐ | ◐ | ● | ◐ | ● | ◐ | ○（靠 bash） |
| MCP | ● | ● | ◐ | ● | ● | ● | ●（stdio+HTTP） |
| Skills / 插件生态 | ● | ● | ◐ | ● | ◐ | ◐ | ◐（本地 MD skill） |
| 权限 / 审批 / 审计 | ◐ | ○* | ◐ | ● | ● | ◐ | **●（差异化优势）** |
| 会话恢复 / checkpoint | ● | ● | ◐ | ◐ | ● | ◐ | **●** |
| 后台长任务 / daemon | ◐ | ◐ | ○ | ◐ | ◐ | ○ | **●（mission+daemon）** |
| 隐私 / 本地存储可解释 | ◐ | ◐ | ◐ | ● | ◐ | ○ | **●（privacy/storage/doctor）** |
| 中文 UX / 本地化 | ◐ | ○ | ○ | ○ | ○ | ○ | **●（核心差异化）** |
| 安装分发（brew/scoop/单包） | ● | ● | ● | ● | ● | ● | ○（npm/bootstrap） |
| SDK 可嵌入 | ◐ | ● | ○ | ● | ● | ○ | ○ |
| 沙箱 / 容器默认安全 | ◐ | 文档化 | ○ | ◐ | ● | ◐ | ○ |
| 测试与 CI 成熟度 | ● | ● | ● | ● | ● | ● | ◐（unit+smoke，缺 E2E 矩阵） |
| 社区 / 文档 / i18n | ● | ● | ● | ● | ● | ● | ◐（中文 README 强，英文弱） |

\* Pi 明确默认不内置权限系统，推荐容器化。

### 3.1 qling 已有优势（应保留并强化）

1. **本地优先的可审计工作台**：privacy / storage / doctor / permissions explain 形成「白盒」叙事。  
2. **中文终端控制面**：slash 中文别名、帮助、状态提示面向中文开发者。  
3. **可恢复长任务**：checkpoint / mission / daemon / workflow resume 超过多数「会话型」CLI。  
4. **治理默认开启意识**：approval gate、内容过滤、审计日志 — 比「默认全权限」更安全。  
5. **规格驱动开发资产**：`docs/superpowers/specs|plans` 体量大，适合继续严格迭代。

### 3.2 qling 关键差距（影响 1.0 后日常可用性）

| ID | 差距 | 对标 | 用户可感知影响 |
|----|------|------|----------------|
| G1 | Provider 抽象弱，无一流式多模型切换 | OpenCode / Pi / Aider | 换模型成本高，本地 Ollama 不「一等公民」 |
| G2 | 无 LSP，编辑依赖 write/patch | OpenCode | 大仓库改码精度与反馈差 |
| G3 | 无 git 原子提交约定 | Aider | 变更不可审查、难回滚 |
| G4 | TUI 质感与稳定性未达标杆 | OpenCode / Crush / Pi | 第一印象与长会话疲劳 |
| G5 | 安装分发路径单一 | 全行业 | 上手摩擦 |
| G6 | 工具层缺 apply_patch 级「安全编辑」闭环 | Codex / Aider | 半截写入、冲突不可见 |
| G7 | 无评测基准（Terminal-Bench / 自建任务集） | OpenHands / 社区 | 无法证明版本变好 |
| G8 | 生态（skills 市场、插件、英文文档）薄 | OpenCode / Goose | 难形成网络效应 |
| G9 | 沙箱/工作区隔离默认弱 | Codex / Pi 容器模式 | 安全叙事不完整 |
| G10 | 包架构单体偏重 | Pi monorepo 分包 | 贡献门槛与复用度 |

---

## 4. 1.0 产品定位（冻结）

### 4.1 一句话

> **轻灵 1.0**：面向中文开发者的**本地优先 AI Agent 工作台 CLI**——可审计、可中断、可继续；不强行成为 OpenCode 的完整克隆。

### 4.2 1.0 契约（必须成立）

1. **安装后 5 分钟内**：`bootstrap` → `setup` → `chat` 能完成一次真实工具调用。  
2. **控制面稳定**：顶层命令与 `/` slash 语义不随意破坏（变更走 deprecation）。  
3. **本地状态可解释**：`doctor` / `privacy` / `storage` / `status` 输出路径与边界。  
4. **失败诚实**：不支持能力明确报错，不伪装成功。  
5. **版本号**：`package.json` 与用户可见 badge / changelog 均为 `1.0.0`。

### 4.3 1.0 明确不做（防止范围爆炸）

- 不做完整 Desktop App  
- 不追求与 OpenCode 对等的 75+ provider 目录（先做好「OpenAI 兼容 + 常用 preset」）  
- 不内置闭源模型专属协议  
- 不在 1.0 强推云同步账号体系

---

## 5. 提升路线（详细）

### Phase 1.0 — 稳定发布门（本次落地 + 短期加固）

**目标**：版本语义进入 1.0；契约与文档对齐；已知 0.x 债务列表化。

| 工作项 | 说明 | 验收 |
|--------|------|------|
| V1.0 版本号 | `package.json` / lock / README / CHANGELOG → `1.0.0` | `npm pkg get version` = `1.0.0` |
| 发布说明 | CHANGELOG 记录 1.0 定位与后续路线入口 | 文档可导航 |
| 对标文档 | 本 spec + plan 入库 | `docs/superpowers/` 可检索 |
| 冒烟门槛 | `npm run ci:check` 绿 | 本地验证 |

### Phase 1.1 — 模型层一等公民（对标 OpenCode/Pi/Aider）

| 工作项 | 参考 | 验收 |
|--------|------|------|
| Provider preset 表 | deepseek / openai / ollama / siliconflow / 自定义 | `qling setup` 可选 preset |
| 会话内 `/model` 切换 | OpenCode 模型切换 | 不重启进程切换 model+endpoint |
| 流式用量统一 | provider usage 优先，缺省估算 | `/usage` 标注 source |
| 本地 Ollama 引导 | doctor 检测 `localhost:11434` | 一键提示安装/拉取模型 |

### Phase 1.2 — 编码质量闭环（对标 Aider/Codex/OpenCode）

| 工作项 | 参考 | 验收 |
|--------|------|------|
| 安全 apply_patch 增强 | Codex apply_patch 语义 | 失败可回滚、输出 unified diff |
| 可选 auto-commit 策略 | Aider | `qling config git.autoCommit=off\|on\|ask` |
| Repo map 增强 | Aider repo map | 大仓 token 预算内可导航 |
| 只读 plan 模式 | OpenCode plan agent | `/permissions plan` 禁止写工具 |

### Phase 1.3 — TUI 产品化（对标 OpenCode/Crush/Pi）

| 工作项 | 参考 | 验收 |
|--------|------|------|
| 差分渲染减闪烁 | Pi TUI | 长流式无明显闪屏 |
| 统一 chrome/statusline | OpenCode | 模式/model/token/mission 一眼可见 |
| 工具卡片折叠 | 主流 TUI | 默认折叠，`/expand` 展开 |
| 可访问性 | 宽字符/Windows 终端 | Windows Terminal + 常见中文字体回归 |

### Phase 1.4 — 分发与上手（对标全行业）

| 工作项 | 参考 | 验收 |
|--------|------|------|
| npm 发布元数据 | engines/keywords/repository/bin | 可 `npm i -g qling` |
| Windows 友好安装 | scoop 清单或 winget 草案 | 文档一条命令安装 |
| 英文 README 最小集 | OpenCode 多语言 | `README.en.md` 存在 |
| 交互式 onboarding 任务 | Gemini CLI 低门槛 | 首次启动引导 3 步任务 |

### Phase 1.5 — 安全与沙箱（对标 Codex/Pi）

| 工作项 | 参考 | 验收 |
|--------|------|------|
| workspace root 默认沙箱 | Codex sandbox | 写工具默认不可出仓 |
| 网络工具默认策略 | Goose/guard | 分 allowlist / deny / ask |
| 密钥扫描强化 | 现有 doctor | pre-tool 扫描 .env 误提交路径 |
| 可选 Docker 运行文档 | Pi containerization | docs 给出 compose 样例 |

### Phase 2.0 — 生态与评测（对标 OpenHands/OpenCode）

| 工作项 | 参考 | 验收 |
|--------|------|------|
| 内置任务评测集 | Terminal-Bench 思路 | `npm run eval:smoke` 可重复 |
| Skills 目录约定 + 示例包 | OpenCode skills | 官方 skills 模板仓库 |
| MCP 一键安装配置 | Goose | `qling mcp add <preset>` |
| 可嵌入 SDK 雏形 | Pi/Cline | `import { AgentLoop } from 'qling'` 文档 |

### Phase 2.1 — 架构演进（可选）

| 工作项 | 参考 | 验收 |
|--------|------|------|
| 分包：`@qling/core` / `@qling/tui` / `@qling/cli` | Pi monorepo | 依赖方向单向 |
| 插件 API 稳定版本 | Goose extensions | semver 策略文档 |

---

## 6. 优先级排序（建议投入）

```
P0（1.0 门禁）     版本号 + CHANGELOG + 契约文档 + ci:check
P1（1.1–1.2）     Provider/Ollama + 安全编辑 + plan 模式 + git 策略
P2（1.3–1.4）     TUI 质感 + 安装分发 + 英文文档
P3（1.5–2.x）     沙箱强化 + 评测 + 生态 + 分包
```

**不要并行做完所有 P1–P3。** 每阶段用真实用户任务（改 bug、写小功能、跑 doctor）做验收。

---

## 7. 风险与诚实边界

| 风险 | 说明 | 缓解 |
|------|------|------|
| 追星标陷阱 | OpenCode 184k 星是生态结果，不是功能 checklist | 坚持本地优先+中文差异化 |
| 范围膨胀 | mission/daemon/dashboard 已够重 | 1.x 优先「编码闭环」而非新子系统 |
| Windows 终端碎片 | 用户主环境为 Windows | 每次 TUI 改动必须 Windows 回归 |
| 安全误伤 | 过严沙箱影响可用性 | 默认「工作区写 + 审批危险操作」 |
| 无基准则空转 | 感觉变好但无证据 | 建 10 个固定本地任务集 |

---

## 8. 非目标（再次强调）

- 复制 Claude Code 专有协议或闭源实现  
- 默认上传代码到云端「增强」  
- 用营销数字替代可复现验证  

---

## 9. 验收清单（本 spec 对应交付）

- [x] GitHub + X 标杆列表与能力矩阵  
- [x] qling 优势 / 差距明确  
- [x] 分阶段提升方案（1.0–2.1）  
- [x] 版本升至 `1.0.0`（见 implementation plan + 代码改动）  
- [ ] 后续 Phase 1.1+ 按独立 spec/plan 拆单实施  

---

## 10. 参考链接

- https://github.com/anomalyco/opencode  
- https://github.com/earendil-works/pi  
- https://github.com/Aider-AI/aider  
- https://github.com/aaif-goose/goose  
- https://github.com/openai/codex  
- https://github.com/google-gemini/gemini-cli  
- https://github.com/OpenHands/OpenHands  
- https://github.com/cline/cline  
- https://github.com/charmbracelet/crush  
- https://github.com/QwenLM/qwen-code  
- https://www.tembo.io/blog/coding-cli-tools-comparison  
- https://pinggy.io/blog/best_open_source_cli_coding_agents/  
