# `qling` TUI 排队输入反馈实施计划（2026-06-01）

## Step 1: 测试先行

- 扩展 `tests/unit/input-queue.test.mjs`：
  - 第一条输入直接处理时不触发 `onQueued`。
  - 当前项未完成时继续提交两条输入，触发两次通知，`pendingCount` 为 1 和 2。
  - 通知数据不要求消费者输出输入正文。

## Step 2: 队列模块增强

- 修改 `src/tui/input-queue.ts`：
  - `SerialInputQueueOptions` 新增 `onQueued`。
  - `enqueue()` 在已有处理或队列非空时调用 `onQueued`。
  - 回调失败时吞掉，避免影响输入入队。

## Step 3: REPL 提示接入

- 修改 `src/tui/streaming-repl.ts`：
  - 构造 `SerialInputQueue` 时传入 `onQueued`。
  - 用 `ui.appendValidation("warn", "输入已排队，等待处理: N")` 输出提示。
  - 文案不得包含用户输入正文。

## Step 4: 验证

- `npm run build`
- `node --test "tests/unit/input-queue.test.mjs" "tests/smoke/chat-exit.smoke.test.mjs"`
- `npm run ci:check`
