# TUI 队列完全空闲后恢复 prompt 计划（2026-06-01）

## Step 1: 测试先行

- 扩展 `tests/unit/streaming-repl-queue.test.mjs`。
- 用 fake `processPrompt()` 阻塞第一条输入，让第二条输入进入 pending。
- 断言第一条输入完成后不会立即恢复 prompt。
- 断言两条输入都完成后只恢复一次 prompt，且状态线不含 `queue=`。

## Step 2: 实现

- 在 `handleUserInput()` 的队列项完成后检查 `inputQueue.isProcessing` 和 `pendingCount`。
- 只有队列完全空闲且 REPL 未关闭时，才刷新状态线并调用 `showPrompt()`。
- 保持 rejected 输入不触发 prompt 恢复。

## Step 3: 验证

- `npm run build`
- `node --test "tests/unit/streaming-repl-queue.test.mjs" "tests/unit/input-queue.test.mjs" "tests/unit/statusline.test.mjs"`
- `node --test "tests/smoke/chat-exit.smoke.test.mjs"`
- `npm run ci:check`
