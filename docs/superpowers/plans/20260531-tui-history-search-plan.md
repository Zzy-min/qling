# `qingling` TUI 历史检索计划（2026-05-31）

## Step 1: 测试先行

- 扩展 `tests/unit/input-buffer.test.mjs`：
  - 当前输入为关键字时，`searchHistory()` 恢复最近匹配项。
  - 当前输入为空时，`searchHistory()` 恢复最近历史。
  - 未命中时返回 `false` 且保留当前输入。

## Step 2: 输入缓冲实现

- 修改 `src/tui/input-buffer.ts`：
  - 新增 `searchHistory(): boolean`。
  - 非空 query 从历史尾部向前查找包含项。
  - 空 query 复用 `historyUp()` 的行为。
  - 命中后同步 `value/cursorPos/historyIdx`。

## Step 3: TUI 接入

- 修改 `src/tui/streaming-tui.ts`：
  - 识别 `Ctrl+R` (`\x12`)。
  - 调用 `input.searchHistory()` 并重绘输入区。
  - header 增加快捷键提示。

## Step 4: 验证

- `npm run build`
- `node --test "tests/unit/input-buffer.test.mjs" "tests/smoke/chat-exit.smoke.test.mjs"`
- `npm run ci:check`
