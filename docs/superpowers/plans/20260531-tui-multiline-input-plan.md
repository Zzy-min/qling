# `qingling` TUI 多行输入计划（2026-05-31）

## Step 1: 测试先行

- 新增 `tests/unit/input-buffer.test.mjs`：
  - 普通字符插入。
  - `insertNewline()` 保留内部换行。
  - 光标移动后插入字符。
  - 退格可删除换行。
  - 历史上/下可恢复多行输入。

## Step 2: 纯输入缓冲

- 新增 `src/tui/input-buffer.ts`：
  - 管理 `value/cursorPos/history/historyIdx`。
  - 提供 `insertChar/insertNewline/backspace/moveLeft/moveRight/historyUp/historyDown/submit/clear`。

## Step 3: TUI 接入

- 修改 `src/tui/streaming-tui.ts`：
  - 使用 `InputBuffer` 代替分散字段。
  - `Ctrl+N` 插入换行。
  - 输入渲染支持多行缩进。
  - `Enter` 和 `\n` 仍提交，保障现有 smoke。

## Step 4: 验证

- `npm run build`
- `node --test "tests/unit/input-buffer.test.mjs" "tests/smoke/chat-exit.smoke.test.mjs"`
- `npm run ci:check`
