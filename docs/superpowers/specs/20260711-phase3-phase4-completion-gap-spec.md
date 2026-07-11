# Spec: Phase 3/4 完整性收尾与运行边界加固

**日期**: 2026-07-11
**状态**: Accepted
**来源**: 对 `20260710-agent-ecosystem-refresh-and-phase3-roadmap-spec.md`、`20260710-phase3-harness-lean-skills-orchestration-plan.md` 与 `20260710-phase4-capability-roadmap-spec.md` 的逐项实现审计

## 1. 目标

将 Phase 3/4 从“局部单测可通过”推进到“关键运行路径有明确边界且可证明”。本轮不扩大产品能力，只修复审计中发现的实现与验收缺口。

## 2. 必须修复的缺口

### 2.1 工具结果上下文上限

- `summarizeToolOutputForContext()` 的最终结果必须受 `maxChars` 约束；元数据提示允许固定小额开销，但不能因默认 head/tail 大于自定义 max 而输出数倍内容。
- JSON 工具结果必须保留原结构字段，只折叠 `output`。
- AgentLoop 写入 tool message 时必须保留 `tool_call_id`，并使用同一卫生处理入口。

### 2.2 子代理隔离与生命周期

- `explore`、`review` 角色不得获得会修改 task/session 状态的 `todo` 工具。
- 子任务成功、失败或超时后必须清理超时计时器并执行 shutdown。
- 超时错误需稳定返回父代理契约，不产生未处理拒绝或长时间残留句柄。

### 2.3 browser_act 网络与会话边界

- 初始导航、重定向和页面子资源都必须经过现有 URL/network guard；被拒绝的请求必须 abort。
- 新建会话在导航失败时必须关闭，避免泄漏浏览器进程。
- 默认池必须提供可显式关闭的生命周期入口；空闲回收描述必须与实际行为一致。

### 2.4 Mission 通知真实性

- Slack HTTP 200 但响应 `{ ok: false }` 时必须判定为 error，不得报告 sent。
- 错误明细不得包含 bot token。
- Telegram/Slack 未配置时继续静默 skipped。

### 2.5 LSP 与代码导航边界

- `lsp` 只允许读取 runtime roots 内文件；越界必须返回稳定错误码。
- `limit` 必须设置上限，避免引用/符号输出冲垮上下文。
- TypeScript LanguageService 必须感知磁盘文件更新，不能长期返回缓存旧结果。
- `code_symbols` 原生遍历同时受文件数和目录/节点预算约束。

### 2.6 可选 LLM eval 真实启用路径

- endpoint 规范化必须兼容 base URL、`/v1` base URL 和完整 `/chat/completions` URL，禁止生成重复 `/v1/v1`。
- 固定短语断言必须精确匹配 `QOK`（忽略大小写和首尾空白），不能接受包含额外文本的回复。
- 使用本地 HTTP server 覆盖“开关开启 + 假 key + 真实 HTTP 请求”路径，不依赖外部服务。

### 2.7 文档与门禁

- 为 Phase 4 补齐 implementation plan。
- `git diff --check` 必须通过。
- 构建、目标单测、完整 CI、旧名称扫描、依赖审计、npm 打包预览均需新鲜证据。

### 2.8 npm 打包生命周期

- `npm pack`/`npm publish` 只能通过一个 lifecycle 入口构建，禁止 `prepack` 与 `prepare` 连续执行两次 `clean + tsc`。
- 保留 `prepare` 以支持 git/npm link 安装；移除重复 `prepack`。
- 打包预览必须在串行构建后执行，不能与全局 npm-link CLI 验证并行清理 `dist/`。

### 2.9 Memory Dream LLM 默认边界

- `QLING_MEMORY_DREAM_LLM_ENABLED` 只有显式 `true|1|on|yes` 才能开启。
- 直接通过 SDK/`AgentLoop` 构造且环境变量缺失时必须保持本地摘要，不得在 shutdown/auto-dream 路径额外调用模型。
- 显式开启时仍要求存在 API key；失败继续降级本地摘要。

### 2.10 动态发现远程边界

- `discovery.allow_unsigned=false` 必须真实生效；没有可验证信任链时，远程 manifest 默认拒绝加载。
- 只有显式 `QLING_DISCOVERY_ALLOW_UNSIGNED=true` 才能加载未验证远程 manifest，并输出诚实风险边界。
- 远程 manifest URL 必须经过现有 network Guard，私网、非法协议和策略拒绝目标不得发起 Axios 请求。
- 远程 manifest 禁止 Axios 自动重定向，避免公网 URL 跳转私网；响应体上限为 1 MiB。
- manifest 至少校验 `id`、`name`、`version`、`type` 和工具名称，畸形输入不得注册。

### 2.11 网页工具文档一致性

- opencli skill 对 browser_act 的描述必须与实现一致：支持同进程跨多次工具调用的 session 保活。

### 2.12 Discovery 可执行性与审批边界

- Discovery manifest 中的 `tools` 只是工具元数据；没有注册运行时 handler/MCP transport 的工具不得加入模型可调用工具列表。
- Registry 必须区分“发现的工具定义”和“当前可执行工具定义”，避免模型看到后必然得到 `TOOL_NOT_FOUND`。
- `requireApproval=true` 的 source 在尚无审批回调时必须拒绝同步，不得静默绕过审批声明。

### 2.13 Workflow checkpoint 恢复完整性

- 新 checkpoint 必须持久化完整 `WorkflowDefinition`，恢复后状态迁移和终态判断继续有效。
- 缺少 workflow definition 的旧 checkpoint 必须明确拒绝恢复，不得把状态改成 running 后静默降级。
- 外部传入的 `runId` 必须限制为安全标识符，禁止通过 `../` 或路径分隔符越出 checkpoint 目录。

### 2.14 Browser Guard 前置检查

- `goto` 或带 URL 的交互动作必须在创建/复用浏览器会话前完成 URL Guard 检查。
- Guard 拒绝不得启动 Playwright、不得在 session pool 留下空白会话。

## 3. 非目标

- 不新增多语言 LSP。
- 不默认开启 browser_act、LSP 或真实 LLM eval。
- 不清零已有 19 条依赖层反向边；保持 `dep:layers --strict` 为后续架构债任务。
- 不自动发布 npm 或创建 release/tag；本轮按用户明确要求提交并推送 GitHub `main`。

## 4. 完成标准

每项缺口都有失败测试、最小修复和通过证据；全量门禁无失败；对仍为 opt-in 或未执行的真实外部路径必须明确标注证据边界，不以 skip 冒充 E2E 通过。
