# TUI 队列命令宽容解析计划（2026-06-01）

## Step 1: 测试先行

- 扩展 `tests/unit/streaming-repl-queue.test.mjs`：
  - `/queue   clear` 可以即时清空 pending。
  - `/清空队列` 可以即时清空 pending。
  - `/queue   status` 输出队列状态。
  - `/queue later` 输出用法提示且不进入 `processPrompt()`。

## Step 2: 解析实现

- 新增队列命令解析 helper，使用 `trim().split(/\s+/)` 归一化。
- 支持英文 `status|clear|cancel` 和中文 `状态|清空|取消`。
- 对未知 `/queue ...` 返回 handled 并提示用法，避免误入队列或 AgentLoop。

## Step 3: 验证

- `npm run build`
- `node --test "tests/unit/streaming-repl-queue.test.mjs" "tests/unit/input-queue.test.mjs"`
- `node --test "tests/smoke/chat-exit.smoke.test.mjs"`
- `npm run ci:check`
