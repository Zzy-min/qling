# Brief 09：ACP 流式输出 + loadSession + prompt 排队 + stdout 守卫（qling）
约束：同 Brief 07；另需手工用任一 ACP 客户端（或 SDK 的 client 测试桩）做冒烟测试。
参考思路：grok-build `xai-acp-lib/src/{stdin_reader,line_reader}.rs`（行上限、背压、stdin 隔离）、`xai-grok-pager/src/app/acp_handler/{queue,prompt_origin,session_notification}.rs`（排队、promptId、轮末信号）；书 §5.1.5（活性信号、扣留中间错误）。

## 任务
1. 流式：AgentLoop 已有供 TUI 使用的流式通道（`streaming_chat` 配置，`index.ts:1088` 附近）。确认该事件或回调的接口后，在 ACP 会话中订阅它，把文本增量合并（≥200ms 或 ≥1KB 一批）后发送 `agent_message_chunk`；轮末不再重复发送全文（仅当没有任何增量时发送全文作为兜底）。
2. 工具事件补全：`tool_call` 带 `rawInput`（参数 JSON，截断到 4KB），`tool_call_update` 带输出摘要（截断到 2KB，复用 `context-tool-hygiene` 的摘要函数）；如果有 todo/plan 事件，映射成 `plan` 更新。
3. `loadSession`：`agentCapabilities.loadSession = true`；实现 `session/load`：创建 agent → `restoreSession(id)` → interrupted-run 检测 → 把历史 user/assistant 消息按 `user_message_chunk` / `agent_message_chunk` 回放，工具调用回放为 completed；找不到时返回 invalidParams。
4. 排队：同一会话在 activePrompt 期间收到新 prompt 时，放入 FIFO（上限 `QLING_ACP_MAX_QUEUED`，默认 4，超出时报错）；前一个 prompt 被 cancel 时清空队列，并让排队的 prompt 返回 `cancelled`。
5. 错误映射：RunOutcome 为 paused / recovery 时返回 `stopReason:"end_turn"`，并发一条说明性的 chunk，而不是 throw；只有不可恢复的错误才 throw。
6. stdout 守卫：`runAcpStdioServer` 启动时把 `console.log/info/debug` 重定向到 stderr（保留原函数，shutdown 时还原）。
7. 空闲回收：会话空闲超过 `QLING_ACP_SESSION_IDLE_MS`（默认 30 分钟）且没有 activePrompt 时 shutdown，并从 Map 中删除。

## 测试（tests/unit/acp-*.test.mjs，使用 SDK 内存流或 mock AgentContext）
增量合并后的 chunk 拼起来等于完整文本；load 能回放 N 条消息；并发两个 prompt 时第二个排队并按顺序完成；排队期间 cancel 的行为；console.log 不写 stdout；空闲回收。
## 度量
人工记录首字时间（TTFT）和长任务期间的通知频率；eval 不下降。
