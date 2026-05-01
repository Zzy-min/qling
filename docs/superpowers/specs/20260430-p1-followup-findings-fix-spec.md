# `qingling` P1 Follow-up Findings 修复设计（2026-04-30）

## 背景
本轮针对 4 个 code review finding 做闭环修复：
1. `run` 模式未调用 `shutdown` 可能导致进程不退出。
2. `memory/mcp/metrics/channels` 配置项定义但未接线生效。
3. Telegram 通道关键发送能力仍为占位实现。
4. `subtask` 仅声明未接入可执行工具链。

## 目标
1. 保证 one-shot `run` 任务结束后可正常退出。
2. 让 Phase 3/4/5 配置项可通过 config 文件驱动运行时。
3. Telegram 通道具备最小可用发送和审批交互能力。
4. `subtask` 可被模型实际调用并执行。

## 方案
1. `run` 生命周期修复
- 在 `src/index.ts` 的 `run` 分支中使用 `try/finally`，确保 `await agent.shutdown()` 必执行。

2. 配置接线修复
- 扩展 `applyConfigToProcessEnv()`，新增写入：
  - `QINGLING_MEMORY_*`
  - `QINGLING_MCP_*`
  - `QINGLING_METRICS_*`
  - `QINGLING_CHANNEL_*`
- `AgentLoop` 从上述 env 实际读取并应用：
  - memory: WAL/projection/dream/max entries
  - mcp: servers + timeouts
  - metrics: enabled/dir/flush interval

3. Telegram 通道最小可用化
- `sendText()` 改为调用 Telegram `sendMessage`。
- `requestApproval()` 改为发送 inline keyboard（allow/deny）。
- `callback_query` 解析审批回调并释放 pending promise。
- 无可用 chat 时立即 deny（避免长时间悬挂）。

4. Subtask 工具接线
- `subtaskTool` 加入 `ALL_TOOLS`。
- 增加 `runSubtask()` 并注册到 dispatch handlers。
- 复用 `SubtaskRunner`，默认深度 1，不允许递归 subtask。

## 验收
1. `npm run build`
2. `npm test`
3. `npm run test:smoke`
4. 手工验证：
- `qingling run "..."` 能正常退出
- Telegram 通道 `sendText` 请求可达（token/chat 配置正确时）
- `subtask` 出现在工具列表且可被 dispatch
