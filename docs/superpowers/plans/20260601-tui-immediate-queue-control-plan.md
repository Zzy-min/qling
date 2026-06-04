# TUI 即时输入队列控制计划（2026-06-01）

## Step 1: 测试先行

- 扩展 `tests/unit/input-queue.test.mjs`：
  - active 输入运行时清空 pending。
  - pending 输入 Promise resolve 为 `false`。
  - 清空不影响 active 输入。
- 扩展 `tests/unit/streaming-repl-queue.test.mjs`：
  - active 输入运行时，第二条普通输入 pending。
  - `/queue clear` 立即执行并清空 pending。
  - 被清空输入不执行，输出不包含输入正文。

## Step 2: 队列能力

- 为 `SerialInputQueue` 新增 `clearPending()`。
- 清空时只处理内存队列，不读取/写入磁盘。
- 被清空项调用 `resolve(false)`，让对应 `handleUserInput()` 不恢复 prompt。

## Step 3: TUI 即时命令

- 在 `StreamingREPL.handleUserInput()` 入队前识别 `/queue`、`/队列`。
- `/queue` 输出本地元数据状态。
- `/queue clear` 和 `/队列 清空` 调用 `clearPending()`。
- 刷新状态线并恢复 prompt，便于用户继续输入。

## Step 4: 验证

- `npm run build`
- `node --test "tests/unit/input-queue.test.mjs" "tests/unit/streaming-repl-queue.test.mjs"`
- `node --test "tests/smoke/chat-exit.smoke.test.mjs"`
- `npm run ci:check`
