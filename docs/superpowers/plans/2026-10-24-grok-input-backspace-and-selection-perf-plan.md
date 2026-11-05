# 结合 Grok Build 源码的输入框长按删除与全屏拖选复制优化实施计划

## 1. 目标

按照设计文档 [`2026-10-24-grok-input-backspace-and-selection-perf-design.md`](file:///C:/Users/Lenovo/projects/qling/docs/superpowers/specs/2026-10-24-grok-input-backspace-and-selection-perf-design.md)，结合 `grok-build` 源码完成两项核心修复与优化：
1. 修复输入框长按删除键（Backspace `\x7f` / `\x08`）导致 `\x7f` 被当作可打印字符插入、光标向右移动的 Bug。
2. 优化全屏模式（Fullscreen TUI）下鼠标拖选复制的性能，消除每次鼠标移动重跑两遍 Markdown 排版与未合并重绘带来的卡顿。

---

## 2. 实施步骤（TDD：RED → GREEN → REFACTOR）

### Step 1: 编写失败测试（RED）
- **文件**：
  - [`tests/unit/input-buffer.test.mjs`](file:///C:/Users/Lenovo/projects/qling/tests/unit/input-buffer.test.mjs)
  - [`tests/unit/tui-fullscreen.test.mjs`](file:///C:/Users/Lenovo/projects/qling/tests/unit/tui-fullscreen.test.mjs)
- **测试内容**：
  1. `InputBuffer` 拒绝插入 `\x7f` / `\x08` 等控制字符，且按完整字符簇（含 Emoji / surrogate pair）执行 `backspace()`、`deleteAfterCursorChar()`、`moveLeft()`、`moveRight()`。
  2. `StreamUI` 在收到长按退格合并 chunk（如 `"\x7f\x7f\x7f"`、 `"\x08\x08"`，无论输入框非空还是已删空）时，正确删除字符，不会将 `\x7f` 插入 `input.value`，且光标列不会向右偏移。
  3. `FullscreenRenderer` 拖选性能与事件合并：
     - `coalesceMouseEvents` 将连续 `drag` 事件合并为最新坐标，同时保留 `down` / `up`。
     - `handleMouse` 在 `drag` 坐标未改变 `selectionHead` 时不触发重复渲染（零 `write` 调用）。
     - 拖选过程中复用已缓存的条目排版结果，不重复构建未变化的 Markdown 内容，且单帧输出合并为单次 `write`。

### Step 2: 修复 `InputBuffer` 与 `StreamUI` 输入处理（GREEN Part 1）
- **文件**：
  - [`src/tui/input-buffer.ts`](file:///C:/Users/Lenovo/projects/qling/src/tui/input-buffer.ts)
  - [`src/tui/streaming-tui.ts`](file:///C:/Users/Lenovo/projects/qling/src/tui/streaming-tui.ts)
- **改动点**：
  1. 在 [`src/tui/input-buffer.ts`](file:///C:/Users/Lenovo/projects/qling/src/tui/input-buffer.ts) 中实现 `prevAtomicBoundary` / `nextAtomicBoundary`（对标 `grok-build` `textarea.rs` `prev_atomic_boundary` / `next_atomic_boundary`）以及控制字符过滤。
  2. 在 [`src/tui/streaming-tui.ts`](file:///C:/Users/Lenovo/projects/qling/src/tui/streaming-tui.ts) 中：
     - 修正可打印字符判定（排除 `\x7f` 及控制字符，对标 `textarea.rs` `if c != '\x08' && c != '\x7f'`）。
     - 修正非 bracketed 多字符 chunk 粘贴快路：仅当 chunk 全部由可粘贴字符组成（不含 `\x7f`、`\x08` 等控制键）时才进入 `insertBulkText`。
     - 支持 `\x08` 与 `\x7f` 退格，并在单次 `dataHandler` 按键循环中合并重绘（避免连发退格每个字节重绘一次）。

### Step 3: 优化 `FullscreenRenderer` 拖选复制与渲染缓存（GREEN Part 2）
- **文件**：
  - [`src/tui/fullscreen.ts`](file:///C:/Users/Lenovo/projects/qling/src/tui/fullscreen.ts)
  - [`src/tui/streaming-tui.ts`](file:///C:/Users/Lenovo/projects/qling/src/tui/streaming-tui.ts)
- **改动点**：
  1. 在 [`src/tui/fullscreen.ts`](file:///C:/Users/Lenovo/projects/qling/src/tui/fullscreen.ts) 中修正 `wrapFullscreenInput` 对 0 宽字符的宽度计算（`Math.max(0, stringWidth(char))`）。
  2. 实现并导出 `coalesceMouseEvents`，在 [`StreamUI.setupInput`](file:///C:/Users/Lenovo/projects/qling/src/tui/streaming-tui.ts#L1994) 中对单个 chunk 内的鼠标事件先合并再分发。
  3. 在 [`FullscreenRenderer.handleMouse`](file:///C:/Users/Lenovo/projects/qling/src/tui/fullscreen.ts#L566) 中：
     - 对齐 `grok-build` `selection.rs` 的 `update_active_text_drag`：当 `point` 与 `selectionHead` 相同且未发生滚动时返回 `false`、跳过 `render()`。
     - 对齐 `grok-build` `textarea.rs` 的边缘自动滚动节流（默认 50ms 间隔），并将边缘滚动与选区更新合并为单次 `render()`。
  4. 为 `Entry` 及 `buildBody` 增加按宽度缓存（包含 `styledLines` 与 `plainLines`），使拖选和滚动时直接复用缓存行，不再每帧调用两遍 `buildBody` 和全量 `formatMarkdownForTerminal` / `stripAnsi`。
  5. 将 `FullscreenRenderer.render()` 的多行增量输出与光标定位合并为单次 `this.writeRaw(...)` 调用。

### Step 4: 构建、回归验证与全局包同步
- 执行 `npm run build`。
- 运行 `node --test tests/unit/input-buffer.test.mjs tests/unit/tui-fullscreen.test.mjs` 及相关 TUI 单元测试。
- 检查全局命令连接状态并确认最新构建生效。
