# 轻灵 ACP stdio 适配规格

## 目标

通过显式的 `qling acp` 命令提供 ACP v1 NDJSON stdio 适配，使支持 ACP 的编辑器能够创建轻灵会话、发送任务、查看工具时间线、处理审批和取消当前任务，同时保持轻灵现有 CLI/TUI 默认行为不变。

## 边界

- stdout 只承载 ACP JSON-RPC；诊断信息继续写 stderr。
- 每个 ACP `session/new` 创建独立 `AgentLoop`，工作区来自请求中的绝对 `cwd`。
- 首版支持基线文本和资源链接输入；资源链接以带 URI 的文本上下文传给模型。
- 首版不接收客户端注入的 MCP server，也不声明 ACP MCP、客户端文件系统或终端能力。
- 模式映射：`normal` 为 ask 权限，`plan` 为计划模式 + ask，`auto` 为 allow 权限。
- 工具开始与结束事件映射为 ACP `tool_call` / `tool_call_update`；最终回答映射为 `agent_message_chunk`。
- ask 权限通过 ACP `session/request_permission` 返回编辑器；取消或未知选择一律拒绝。
- `session/cancel` 中止当前模型请求并使本轮以 `cancelled` 结束。关闭 stdio 时释放全部本地会话。

## 兼容与隐私

- 仅新增显式子命令，不改变 `run`、TUI、Headless JSON schema。
- API Key、个人绝对缓存目录和完整工具输出不进入 ACP 状态更新。
- `cwd` 必须是已存在的绝对目录；额外目录和客户端 MCP 在首版结构化拒绝，禁止静默忽略。

## 验收

- CLI 能稳定解析 `qling acp`，帮助文本说明 stdio 与 stdout 边界。
- 初始化协商协议版本并只声明真实能力。
- 新建会话、模式切换、文本/资源链接 prompt、工具事件、审批、取消均有单测。
- 同一 session 拒绝并发 prompt，未知 session/mode 返回明确错误。
- 通过 `npm run build`、`npm run ci:check`、恢复评测和 `git diff --check`。
