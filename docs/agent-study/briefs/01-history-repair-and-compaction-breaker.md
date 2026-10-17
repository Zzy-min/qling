# Brief 01：发送前历史修复 + 压缩熔断（qling）
约束：只改本地工作区，不 commit/不 push。必须通过 `npm test`；用 `npm run eval:smoke`、`npm run eval:recovery` 前后对比。
参考（思路，TS 重写，不拷贝）：grok-build `crates/codegen/xai-chat-state/src/compaction_utils.rs` 中 `repair_history`、`strip_displaced_tool_results`、`truncate_trailing_incomplete_tool_call`、`is_degenerate_summary`（Apache-2.0）。

## 任务
1. 新建 `src/context-history-repair.ts`，导出纯函数 `repairHistory(messages: Message[]): { messages; report: { duplicatesRemoved; strippedToolResultIds: string[]; syntheticResultsInserted } }`：
   - 删除同一 tool_call_id 的重复 tool 消息（保留首个）；
   - 删除不在"紧随其声明 assistant 的连续 tool 段"内的 tool 消息（错位/孤儿）；
   - 对 assistant.tool_calls 中未应答的 id，在该连续段末尾插入合成 tool 消息 `{role:"tool", tool_call_id, content:"[工具未返回结果：执行被中断]", synthetic_reason:"history_repair"}`（确认 Message 类型字段名，参考 src/types.ts）；
   - 幂等：二次调用 report 全零。
2. 在发往 provider 前（`src/providers/llm-client.ts` 组装 messages 处或 `src/agent/main-loop.ts` 调用前，择一）调用；report.changed 时通过现有 event bus/`host.emit` 记一条 debug。
3. `ContextCompactor`（`src/context-compactor.ts`）：
   - 摘要长度 < `QLING_COMPACTION_MIN_SUMMARY_CHARS`（默认 200，中文偏短）视为失败；
   - 会话级 `consecutiveFailures`，达到 `QLING_COMPACTION_BREAKER`（默认 3）后自动压缩直接走 `buildLocalFallbackSummary`，成功一次后清零；状态写入 `compactDetailed` 返回值。
4. 压缩结果出来后也跑一次 `repairHistory`。

## 测试
`tests/unit/context-history-repair.test.mjs`：重复、孤儿、错位（中间插 user）、未应答、幂等五个用例；compactor 熔断用 mock summarizer 连续返回空串。
## 度量
记录 eval:smoke/eval:recovery 通过率与 provider 400 次数（如 run-trace-store 有记录）前后对比。
