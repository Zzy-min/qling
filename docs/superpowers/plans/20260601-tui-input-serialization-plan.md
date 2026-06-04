# `qingling` TUI 输入串行队列实施计划（2026-06-01）

## Step 1: 测试先行

- 新增 `tests/unit/input-queue.test.mjs`：
  - 连续 `enqueue()` 多个异步任务时 `maxActive` 始终为 1。
  - 完成顺序与提交顺序一致。
  - 某个任务抛错时，错误进入 `onError`，后续任务仍执行。
  - `pendingCount` 能反映队列中待处理数量。

## Step 2: 队列模块

- 新增 `src/tui/input-queue.ts`：
  - `SerialInputQueue`。
  - `enqueue(input, handler)`。
  - `pendingCount` 与 `isProcessing`。
  - 内部 drain 循环使用 Promise 链保证不重入。

## Step 3: REPL 接入

- 修改 `src/tui/streaming-repl.ts`：
  - `handleUserInput()` 只负责入队。
  - 提取原逻辑为 `handleQueuedUserInput()`。
  - 队列错误通过 `ui.appendError()` 展示，并继续处理后续输入。

## Step 4: 验证

- `npm run build`
- `node --test "tests/unit/input-queue.test.mjs" "tests/smoke/chat-exit.smoke.test.mjs"`
- `npm run ci:check`
