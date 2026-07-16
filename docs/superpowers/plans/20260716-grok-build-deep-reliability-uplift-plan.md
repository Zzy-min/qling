# 轻灵 × Grok Build 深度可靠性升级实施计划

1. 新增 Prompt 分层、SyntheticReason 与 inspect 快照，接入 AgentLoop 和会话持久化。
2. 新增 ContextBudget，重构 ContextCompactor 为 provider 回调摘要和显式结果状态。
3. 新增 MCP ToolCatalog、按需调度工具、20 KiB 输出限制、loop 事件和整数成本账本。
4. 扩展子代理回传契约，拒绝未知角色并聚合真实 usage。
5. 新增默认关闭的锚定读写工具和本地 JSON Hook runner。
6. 更新配置、Headless JSON、Statusline、Doctor/帮助和相关文档。
7. 依次运行定向测试、构建、全量 CI、恢复评测和差异检查；按失败模块窄修复。
