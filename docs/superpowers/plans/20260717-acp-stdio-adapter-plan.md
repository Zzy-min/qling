# 轻灵 ACP stdio 适配实施计划

1. 在 CLI 契约中注册 `acp` 管理模式和帮助入口。
2. 增加可测试的 ACP app：维护 session map、输入转换、模式映射、工具事件和审批通道。
3. 为 `AgentLoop` 与 LLM HTTP 客户端增加当前运行的协作式取消信号，避免取消被恢复循环误判。
4. 在 `src/index.ts` 复用当前加载后的配置与工具表，以 stdio 启动 ACP 连接，协议关闭后清理全部会话。
5. 用 SDK 的进程内 client/agent 连接覆盖初始化、会话、模式、prompt、工具、审批与取消，再运行完整门禁。
