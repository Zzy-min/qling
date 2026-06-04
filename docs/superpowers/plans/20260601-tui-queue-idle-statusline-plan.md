# TUI 队列空闲状态线恢复计划（2026-06-01）

## Step 1: 测试先行

- 新增 `tests/unit/streaming-repl-queue.test.mjs`。
- 用 fake Agent/UI/Scheduler 替换真实 runtime。
- 调用 `handleUserInput()` 处理普通输入。
- 断言 `showPrompt()` 看到的最终状态线不包含 `queue=`。

## Step 2: 调整 prompt 恢复职责

- `handleUserInput()` 等待 `SerialInputQueue.enqueue()` 返回。
- 输入被接受且 REPL 未关闭时，统一刷新状态线并恢复 prompt。
- `handleQueuedUserInput()` 删除内部 `refreshStatusLine()` 和 `showPrompt()`。

## Step 3: 验证

- `npm run build`
- `node --test "tests/unit/streaming-repl-queue.test.mjs" "tests/unit/statusline.test.mjs" "tests/unit/input-queue.test.mjs"`
- `node --test "tests/smoke/chat-exit.smoke.test.mjs"`
- `npm run ci:check`
