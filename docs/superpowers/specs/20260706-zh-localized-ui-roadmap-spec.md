# 轻灵中文本地化与 UI 体验增强 Spec

## Goal

按“先稳固本地中文体验，再增强可视化，再扩展国内生态”的顺序推进轻灵的中文、本地化和 UI 体验。

目标不是把轻灵改成 Dify/Wanwu 式重型 Web 平台，而是在现有 local-first CLI/TUI 基础上吸收它们的长处：

- Dify 的本地化文案体系
- AgentScope 的白盒可观测
- LangBot 的国内连接器引导
- Chatchat 的中文 RAG 默认值

## Key Changes (Phased)

### P0：中文本地化文案与错误体验统一
- 新增轻量 `src/i18n/` 文案目录，默认 `zh-CN`。
- 先覆盖 TUI 首屏、slash 命令、doctor/privacy/storage/setup/bootstrap、错误面板。
- 抽出统一错误/帮助 formatter：所有 CLI/TUI 错误都输出 原因 / 下一步 / 示例 / 是否本地执行 / 是否调用模型。
- 清理硬编码散落文案，建立中文文案单一事实源（暂不做多语言切换 UI）。
- 借鉴 Dify：provider、模型、工具、工作流、密钥、隐私边界都用用户能理解的中文标签和解释。

### P1：TUI 专属本地化界面升级
- 保持现有非全屏终端模式，修复输入框、表格、slash panel、状态线的视觉一致性（优先 Windows Terminal / PowerShell）。
- 新增本地工作台首页：显示模型、workspace、记忆状态、权限模式、最近会话、推荐命令。
- `/` 命令面板按中文场景分组：常用、代码、记忆、上下文、Git、诊断、连接器、高级。
- 输出渲染增强 Markdown 表格、列表、代码块和工具执行 timeline。
- 吸收 Claude Code 流畅输入体验，但视觉和文案保持轻灵中文风格。

### P2：本地 Web Dashboard 从占位页升级为可观测 UI
- 将当前 dashboard HTML 占位页升级为无/轻依赖的本地 Web 控制台。
- 第一版以只读为主：会话、任务、工具调用、token、memory、permissions、doctor 状态。
- 控制操作仅保留安全动作：pause/resume、打开 session、导出报告。
- 借鉴 AgentScope Studio：重点展示 agent event timeline、tool call、memory link、permission decision。
- 默认关闭，通过 `/dashboard` 或配置显式启动。

### P3：中文模型与知识库/RAG 默认值
- 新增 `qling knowledge` 或 `/knowledge` 能力：本地文件索引、中文 chunk 策略、搜索、引用展示。
- 默认适配 DeepSeek/Qwen/GLM/Ollama 常见组合，给出中文 embedding/rerank 配置推荐。
- 借鉴 Langchain-Chatchat：重点做中文知识库导入、问答引用、离线/私有化说明。
- 先把 CLI/TUI 的导入、搜索、引用链路跑通，不做复杂 Web 知识库管理。

### P4：国内平台连接器引导
- 新增 `/connect` 或 `qling connect` 统一入口，先覆盖已有 Telegram/Slack，再规划 Feishu/DingTalk/WeChat。
- 每个连接器提供中文向导：准备材料、权限边界、token 存放方式、连通性测试、失败排查。
- 借鉴 LangBot：把复杂 IM 接入做成分步引导 + doctor 检查。
- 默认不保存明文敏感 token；沿用 secret scanner 和 doctor 警告机制。

## Non-goals (本轮)
- 不改造成重型 Web 平台（Dify/Wanwu 风格）。
- 不实现完整多语言切换 UI。
- Web Dashboard 只做本机只读观测，不做云端/多租户/账号系统。
- RAG 和连接器都保守：不自动上传、不默认联网、不保存明文密钥。
- 不破坏现有 CLI/TUI 核心命令语义和存储格式。

## Requirements
- 中文体验优先，建立 `src/i18n/` 作为中文文案单一事实源。
- 所有错误和帮助面板必须使用统一 formatter，明确本地边界。
- 每阶段独立可验证，优先保证 Windows 终端体验。
- 所有敏感信息处理必须通过现有 guard/doctor/privacy 机制。

## Acceptance Criteria
- P0 完成：i18n 覆盖主要入口，CLI/slash 错误使用统一中文面板，setup 密钥安全。
- P1 完成：TUI 有首页、slash 按中文场景分组、输出渲染改善、Windows 宽字符稳定。
- P2 完成：Dashboard 可作为本地只读观测台打开，展示 timeline 等信息。
- P3 完成：`knowledge` / RAG 最小闭环可用，中文 chunk + 引用链路跑通。
- P4 完成：连接器向导可用，doctor 能诊断常见问题。
- 全流程通过构建、测试、CI 门禁，无敏感信息泄露。

## Test Plan
- P0：i18n + formatter 单测，断言中文完整、错误不泄露 secret、slash/CLI help 一致。
- P1：TUI 单测覆盖首页、slash 分组、表格/Markdown、长输入、Windows 宽字符。
- P2：dashboard smoke 测试（本地可打开、只读、API 返回 JSON、不调用模型）。
- P3：knowledge/RAG 单测（中文 chunk、搜索、引用、本地模型缺失提示）。
- P4：connect/doctor 测试（缺 token、错 token、成功配置、脱敏）。
- 每阶段门禁：`npm run build` + 相关测试 + `npm run ci:check` + `git diff --check` + `npm audit --audit-level=high`。

## References / Inspiration
- Dify 本地化文案
- AgentScope Studio 可观测
- LangBot 国内连接器引导
- Langchain-Chatchat 中文 RAG

## Open Questions
- Dashboard 技术选型（纯静态 HTML + fetch 还是轻量框架？优先静态）。
- RAG 默认 chunk 策略细节（在 P3 设计时确定）。
- 具体国内平台优先级（先 Feishu 还是 WeChat？）。
