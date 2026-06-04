# `qling` TUI 输入队列背压实施计划（2026-06-01）

## Step 1: 测试先行

- 扩展 `tests/unit/input-queue.test.mjs`：
  - `maxPending=1` 时，当前输入运行中允许一个待处理输入。
  - 第二个待处理输入被拒绝。
  - 被拒绝输入的 handler 不执行。
  - `onRejected` 事件包含 `pendingCount/maxPending`，不包含 `input`。

## Step 2: 队列模块增强

- 修改 `src/tui/input-queue.ts`：
  - options 新增 `maxPending` 和 `onRejected`。
  - `enqueue()` 返回 `Promise<boolean>`。
  - 队列满时不 push、不 drain，直接触发拒绝事件并返回 `false`。
  - 回调错误吞掉，避免影响输入处理。

## Step 3: REPL 接入

- 修改 `src/tui/streaming-repl.ts`：
  - 构造 `SerialInputQueue` 时设置 `maxPending: 20`。
  - 接入 `onRejected`，输出不含正文的中文警告。

## Step 4: 验证

- `npm run build`
- `node --test "tests/unit/input-queue.test.mjs" "tests/smoke/chat-exit.smoke.test.mjs"`
- `npm run ci:check`
