# `qingling` 审查发现修复设计（2026-05-01）

## 背景
本轮代码审查确认 4 个问题：
1. `tool_calls` 参数解析对非严格 JSON 无容错，可能直接中断主循环。
2. `chat` 模式缺少稳定的 shutdown 收口，存在 WAL/metrics 未清理风险。
3. Slack 审批通过覆盖 `userMessageHandler` 处理，存在并发审批与超时后的状态漂移风险。
4. 配置项 `llm.request_timeout_ms`、`runtime.parse_retries`、`runtime.tool_repeat_limit` 已暴露但未完整体现在运行逻辑。

## 目标
1. 保证 `tool_calls` 参数异常时不会导致主循环崩溃，并输出结构化错误。
2. 保证 `chat` 模式可显式退出并触发 `agent.shutdown()`。
3. 将 Slack 审批改为独立 pending map 路由，避免覆盖主消息处理链。
4. 让 `request_timeout_ms`、`parse_retries`、`tool_repeat_limit` 在运行期真实生效。

## 非目标
1. 不引入新的交互协议或外部依赖。
2. 不重构 channel 抽象层接口。

## 方案

### A. `tool_calls` 参数容错 + 解析重试
- 在 `AgentLoop` 增加参数解析函数：
  - 基于 `runtime.parse_retries` 尝试多轮解析。
  - 支持常见修复：去代码块包裹、去尾逗号、规范引号。
- 对仍无法解析的工具调用，不抛出异常中断；写入该 tool 的错误结果并继续流程。

### B. `chat` 模式退出清理
- `StreamingREPL` 增加显式退出命令（`q/quit/exit`）。
- 退出路径中执行 `agent.shutdown()`，再释放 TUI 输入监听，返回主流程。
- `index.ts` 的 `chat` 分支改为 `await repl.start()`，由 REPL 生命周期决定退出时机。

### C. Slack 审批并发安全
- `SlackChannel` 引入独立 `pendingApprovals` 映射，按短 ID 路由 `allow/deny`。
- 不再覆写 `userMessageHandler`。
- 审批请求加本地 TTL，超时自动 deny 并清理 pending。

### D. 配置项落地
- LLM HTTP 请求超时改为优先使用 `QINGLING_LLM_REQUEST_TIMEOUT_MS`（来自配置映射）。
- `runtime.tool_repeat_limit` 用于限制同签名工具调用重复次数，超限返回结构化错误而非无限重复。

## 验收
1. `npm run build` 通过。
2. `npm test` 通过。
3. `npm run test:smoke` 通过。
4. 新增回归测试覆盖：
   - tool 参数解析失败不崩溃
   - Slack 审批并发路由
   - chat 退出清理路径（至少单元行为覆盖）
