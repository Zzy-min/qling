# TUI 输入队列状态线实施计划（2026-06-01）

## Step 1: 测试先行

- 扩展 `tests/unit/statusline.test.mjs`：
  - 有 pending 输入时输出 `queue=<pending>/<max>`。
  - 正在处理但无 pending 时输出 `queue=run/<max>`。
  - 空闲时不输出 `queue=`。
  - `collectStatusLineSnapshot()` 读取 context 中的输入队列元数据。
- 扩展 `tests/unit/input-queue.test.mjs`：
  - `SerialInputQueue` 暴露只读 `maxPendingCount`。

## Step 2: 状态线模型

- 扩展 `StatusLineSnapshot`，新增可选 `inputQueue` 元数据。
- 新增内部格式化逻辑，只输出计数和上限，不输出输入正文。
- `collectStatusLineSnapshot()` 从 `SlashCommandContext.inputQueue` 复制只读状态。

## Step 3: TUI 注入

- 扩展 `SlashCommandContext` 类型，新增可选 `inputQueue` 字段。
- 在 `StreamingREPL.createSlashContext()` 中注入当前 `SerialInputQueue` 状态。
- 为 `SerialInputQueue` 增加 `maxPendingCount` getter。

## Step 4: 验证

- `npm run build`
- `node --test "tests/unit/statusline.test.mjs" "tests/unit/input-queue.test.mjs"`
- `npm run ci:check`
