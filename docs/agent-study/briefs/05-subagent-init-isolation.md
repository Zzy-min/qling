# Brief 05：子 agent 初始化隔离 + 角色白名单兜底（qling）
约束：同 Brief 04（不 commit/push；`npm test` 不新增失败；eval:smoke/eval:tasks 对比）。
参考思路：grok-build `crates/codegen/xai-grok-subagent-resolution/src/definition.rs` `apply_child_tool_policy`、`overrides.rs` `intersect_capability_modes`、`context.rs` `normalize_forked_context`；书 §2.7.6。

## 背景（先写失败测试复现）
`src/agent/subtask.ts:91-104` 先 `filterToolsForRole` 再 `new AgentLoop(...)`；`AgentLoop.init()`（agent-loop.ts:456 起）会：461 行再装 JSON hooks 并发 SessionStart；624–653 行在 `QLING_MCP_SERVERS` 存在时重连全部 MCP 并把 MCP 工具追加到 `this.config.tools`——绕过角色白名单。

## 任务
1. `AgentConfig`/runtime 增加 `subagent?: { parentSessionId: string; role: string; mcpRegistry?: MCPRegistry }`。
2. `init()`：
   - subagent 时不调用 `installJsonHooks` 的 SessionStart；改由父进程 JsonHookRunner 发 `SubagentStart`/`SubagentStop`（JsonHookEvent 增加这两个，payload: role、task 前 200 字、success、durationMs）；
   - subagent 时不新建 MCPRegistry；若角色白名单显式包含 `mcp__*` 模式，才复用父 registry 的工具；否则不注入。
3. init 结束后（`waitForInit` 之后）在 `SubtaskRunner.run` 中再次 `subAgent.config.tools = filterToolsForRole(...)`（或提供 `setTools`）作为兜底；同样适用于 `subtask-parallel.ts`。
4. 可选：`parentContext` 规范化函数 `normalizeParentContext(messages, {verbatimTurns:3})`：最近 3 轮原文，更早只列"用户消息数/调用过的工具/提到的文件"。

## 测试
mock `QLING_MCP_SERVERS`（或注入假 registry），断言 explorer 子 agent 的工具列表不含 `mcp__*`/`use_tool`、MCP connect 次数=父进程 1 次、hooks 审计里无子 agent 的 SessionStart；normalizeParentContext 的轮数/元数据用例。
## 度量
eval 通过率不降；记录配置 2 个 stdio MCP server 时一次 subtask 的耗时与子进程数前后对比。
