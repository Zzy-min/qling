# 结合 Grok Build 源码的输入框长按删除与全屏拖选复制优化设计

## 1. 背景与问题陈述

用户在 Qling TUI（[`src/tui/streaming-tui.ts`](file:///C:/Users/Lenovo/projects/qling/src/tui/streaming-tui.ts)、[`src/tui/fullscreen.ts`](file:///C:/Users/Lenovo/projects/qling/src/tui/fullscreen.ts)、[`src/tui/input-buffer.ts`](file:///C:/Users/Lenovo/projects/qling/src/tui/input-buffer.ts)）中反馈了两个核心交互缺陷，并明确要求**结合 `grok-build`（`D:\Projects\Archive\Reference\grok-build`）源码**进行设计与修复：

1. **输入框中长按删除号（Backspace），光标会向右移动**。
2. **全屏模式（Fullscreen TUI）下鼠标拖选复制太过卡顿**。

---

## 2. 对标 `grok-build` 源码的根因分析

### 2.1 问题一：长按删除号（Backspace）导致光标右移

#### Qling 现有实现根因
1. **多字节 Chunk 误判为纯文本粘贴并把 `\x7f` 当作可打印字符插入**：
   - 在 [`StreamUI.setupInput`](file:///C:/Users/Lenovo/projects/qling/src/tui/streaming-tui.ts#L2020-L2037) 中：
     ```ts
     if (!bracketedPaste && !chunk.includes("\x1b") && chunk.length > 1) {
       ...
       this.insertBulkText(normalized);
       return;
     }
     ```
     当用户**长按 Backspace**（键盘连发 key-repeat）时，一旦主线程在执行渲染，操作系统的多个 `\x7f`（DEL，127）或 `\x08`（BS，8）字节会被 Node.js `process.stdin` 合并进同一个 `data` chunk（如 `chunk = "\x7f\x7f\x7f"`，`chunk.length > 1` 且不含 `\x1b`）。
   - 该 chunk 直接命中了上述“非 bracketed 粘贴整块插入”分支，进入 [`StreamUI.insertBulkText`](file:///C:/Users/Lenovo/projects/qling/src/tui/streaming-tui.ts#L2312-L2327)。
   - 在 [`insertBulkText`](file:///C:/Users/Lenovo/projects/qling/src/tui/streaming-tui.ts#L2322)（以及 [`setupInput`](file:///C:/Users/Lenovo/projects/qling/src/tui/streaming-tui.ts#L2073) / [`L2243`](file:///C:/Users/Lenovo/projects/qling/src/tui/streaming-tui.ts#L2243)）中，可打印字符判断写成了：
     ```ts
     else if (ch >= " " || ch === "\t") {
       this.input.insertChar(ch);
     }
     ```
     由于 `"\x7f".charCodeAt(0) === 127 > 32`，`"\x7f" >= " "` 为 **`true`**！
   - 结果：长按 Backspace 时，合并到达的 `\x7f` 不仅没有触发退格删除，反而被当作普通字符插入到了 [`InputBuffer.value`](file:///C:/Users/Lenovo/projects/qling/src/tui/input-buffer.ts#L23-L30) 中，`cursorPos` 每次递增！
2. **折行器将 0 宽控制字符强行算作 1 列宽，推动屏幕光标右移**：
   - 在 [`wrapFullscreenInput`](file:///C:/Users/Lenovo/projects/qling/src/tui/fullscreen.ts#L243) 中：
     ```ts
     const charWidth = Math.max(1, stringWidth(char));
     ```
     `stringWidth("\x7f")` 为 `0`，但 `Math.max(1, 0)` 将每个被错误插入的 `\x7f` 强行计为 **1 列宽度**，导致 `wrapped.cursorCol` 不断增加，终端物理光标肉眼可见地**向右移动**。
3. **缺少 `\x08`（BS / Ctrl+H）退格处理及 Grapheme/CodePoint 原子边界**：
   - 在 [`setupInput`](file:///C:/Users/Lenovo/projects/qling/src/tui/streaming-tui.ts#L2107) 中只识别了 `seq === "\x7f"`，未识别终端常见的 `\x08`（BS）。
   - 在 [`InputBuffer.backspace`](file:///C:/Users/Lenovo/projects/qling/src/tui/input-buffer.ts#L36-L40)、[`deleteAfterCursorChar`](file:///C:/Users/Lenovo/projects/qling/src/tui/input-buffer.ts#L119-L122)、[`moveLeft`](file:///C:/Users/Lenovo/projects/qling/src/tui/input-buffer.ts#L42-L46)、[`moveRight`](file:///C:/Users/Lenovo/projects/qling/src/tui/input-buffer.ts#L48-L52) 中按 UTF-16 code unit（`cursorPos ± 1`）切片，遇到 surrogate pair（如 Emoji）会切成半个代理项，导致光标与显示宽度失步。

#### `grok-build` 源码对照
1. **显式拦截 `\x08` 与 `\x7f`，绝不作为普通字符插入**：
   - 在 [`xai-ratatui-textarea/src/textarea.rs`](file:///D:/Projects/Archive/Reference/grok-build/crates/codegen/xai-ratatui-textarea/src/textarea.rs#L1967-L1986) 中：
     ```rust
     KeyEvent { code: KeyCode::Char('\u{007f}'), .. } /* DEL */ |
     KeyEvent { code: KeyCode::Char('\u{0008}'), modifiers: KeyModifiers::NONE, .. } /* BS */ => {
         self.delete_backward(1);
     }
     KeyEvent {
         code: KeyCode::Char(c),
         modifiers: KeyModifiers::NONE | KeyModifiers::SHIFT,
         ..
     } if c != '\x08' && c != '\x7f' => {
         ...
         self.insert_str(&c.to_string());
     }
     ```
2. **非 bracketed 粘贴合并仅针对真正可粘贴按键（排除退格/控制字符），且批量事件合并只重绘一次**：
   - 在 [`xai-grok-pager/src/app/event_loop.rs`](file:///D:/Projects/Archive/Reference/grok-build/crates/codegen/xai-grok-pager/src/app/event_loop.rs#L2981-L3076) 中，`is_pasteable_key_event` 仅允许可打印字符、Enter、Tab，绝不把连发的 Backspace 合并为 Paste；并且 [`drain_and_process`](file:///D:/Projects/Archive/Reference/grok-build/crates/codegen/xai-grok-pager/src/app/event_loop.rs#L2629-L2891) 在同一个输入批次处理完所有退格后只触发一次 `app.draw(terminal)`。
3. **基于 Grapheme / Atomic Boundary 的退格与光标移动**：
   - 在 [`textarea.rs`](file:///D:/Projects/Archive/Reference/grok-build/crates/codegen/xai-ratatui-textarea/src/textarea.rs#L2469-L2501) 中，`delete_backward(n)` 和 `delete_forward(n)` 通过 `prev_atomic_boundary` / `next_atomic_boundary` 按完整字符簇（grapheme/code point）删除。

---

### 2.2 问题二：鼠标拖选复制太过卡顿

#### Qling 现有实现根因
1. **鼠标 Drag 事件风暴无合并（Uncoalesced Mouse Drag Storm）**：
   - 在 [`StreamUI.setupInput`](file:///C:/Users/Lenovo/projects/qling/src/tui/streaming-tui.ts#L1990-L1997) 中：
     ```ts
     for (const event of mouse.events) {
       this.fullscreen.handleMouse(event);
     }
     ```
     终端在鼠标拖拽时每秒上报 60~250+ 个 SGR 鼠标包（`\x1b[<32;col;rowM`），单个 `stdin` chunk 内往往包含多个连续 `drag` 事件。Qling 对每个事件逐一同步调用 `handleMouse` -> `this.render()`。
2. **`selectionHead` 未变化时仍无条件重绘，且边缘滚动触发双重重绘**：
   - 在 [`FullscreenRenderer.handleMouse`](file:///C:/Users/Lenovo/projects/qling/src/tui/fullscreen.ts#L593-L622) 中：
     - 当 `event.kind === "drag"` 位于首尾行时，立即调用 `this.scrollLines(±2)`（内部调用一次 `this.render()`），紧接着第 621 行又调用一次 `this.render()`，单次事件触发两次全量渲染，且没有任何时间节流（以鼠标回报率狂滚）。
     - 当鼠标在同一单元格或同一逻辑坐标内微动（`point` 与当前 `selectionHead` 相同）时，仍然执行 `this.render()`。
3. **每帧 `compose()` 双重调用 `buildBody()` + 全量条目重跑 Markdown 渲染与 `stripAnsi`**：
   - 在 [`FullscreenRenderer.compose`](file:///C:/Users/Lenovo/projects/qling/src/tui/fullscreen.ts#L947-L951) 中：
     ```ts
     let body = this.buildBody(width);
     const showScrollbar = body.length > bottomContentHeight && width >= 44;
     const contentWidth = showScrollbar ? width - 2 : width;
     if (showScrollbar) body = this.buildBody(contentWidth);
     this.logicalBodyPlain = body.map(stripAnsi);
     ```
     只要内容超过一屏（出现滚动条），**每一帧 `compose()` 都会把所有历史消息（最多 240 条）通过 `formatMarkdownForTerminal` 重新解析渲染两遍**！随后又对整個 `body` 执行 `.map(stripAnsi)`！
   - 在拖选过程中，对话条目（`entries`）和终端宽度根本没有变化，唯一变化的是 `selectionHead` 坐标和可见视口内行的反色高亮，却在每个鼠标事件上重复执行 2 次全量 Markdown 排版。
4. **逐行多次 `writeRaw` 写 stdout，缺少单帧缓冲合并**：
   - 在 [`FullscreenRenderer.render`](file:///C:/Users/Lenovo/projects/qling/src/tui/fullscreen.ts#L1050-L1059) 中，逐行调用 `this.writeRaw(...)` 加上末尾光标定位，一帧触发多达数十次系统写调用。

#### `grok-build` 源码对照
1. **输入批次合并与帧率节流（`drain_and_process` + `min_draw_interval`）**：
   - [`xai-grok-pager/src/app/event_loop.rs`](file:///D:/Projects/Archive/Reference/grok-build/crates/codegen/xai-grok-pager/src/app/event_loop.rs#L2629-L2891) 先将通道内所有待处理事件一次性取出处理，同一批事件只置 `needs_draw = true`，最后按 `min_draw_interval`（16ms）最多执行一次 `app.draw(terminal)`。
2. **Selection Head 变更检测（Unchanged 短路）**：
   - [`xai-grok-pager/src/app/agent_view/selection.rs`](file:///D:/Projects/Archive/Reference/grok-build/crates/codegen/xai-grok-pager/src/app/agent_view/selection.rs#L495-L534) 中，`update_active_text_drag` 计算 `let changed = head != drag.head || kind != drag.kind;`，仅在 `changed` 为 `true` 时返回 `InputOutcome::Changed` 触发重绘；指针未跨越字符格时返回 `InputOutcome::Unchanged`，零渲染开销。
3. **边缘拖拽自动滚动节流（Drag-Scroll Ramp/Throttle）**：
   - [`xai-ratatui-textarea/src/textarea.rs`](file:///D:/Projects/Archive/Reference/grok-build/crates/codegen/xai-ratatui-textarea/src/textarea.rs#L1213-L1230) 与 [`selection.rs`](file:///D:/Projects/Archive/Reference/grok-build/crates/codegen/xai-grok-pager/src/app/agent_view/selection.rs#L163-L241) 对边缘自动滚动施加上限节流（80ms → 60ms → 40ms），避免按鼠标回报率瞬间滚飞。
4. **条目级渲染缓存（Per-Entry Render Cache Keyed by Width）**：
   - [`selection.rs`](file:///D:/Projects/Archive/Reference/grok-build/crates/codegen/xai-grok-pager/src/app/agent_view/selection.rs#L105) 通过 `entry.effective_output(content_width, ...)` 复用按宽度缓存的已排版行与纯文本行；拖选只更新视口切片上的高亮层，绝不在鼠标移动时重跑 Markdown 解析。

---

## 3. 设计方案

### 3.1 输入框退格、控制字符过滤与批处理设计（对应 `input-buffer.ts` / `streaming-tui.ts` / `fullscreen.ts`）

1. **禁止 `\x7f` 及控制字符进入可打印字符插入路径**：
   - 新增辅助函数 `isPrintableInputChar(ch: string): boolean`（对标 `grok-build` `textarea.rs` `c != '\x08' && c != '\x7f'`）：要求 `ch === "\t" || (codePoint >= 0x20 && codePoint !== 0x7f && !(codePoint >= 0x80 && codePoint <= 0x9f))`。
   - 在 [`InputBuffer.insertChar`](file:///C:/Users/Lenovo/projects/qling/src/tui/input-buffer.ts#L23-L30) 中同样拦截 `\x7f` 与除 `\n`/`\t` 外的 C0/C1 控制字符，从源头保证缓冲区不会混入不可见控制字节。
2. **修复非 bracketed 多字符 chunk 快路与连发退格批处理**：
   - 在 [`StreamUI.setupInput`](file:///C:/Users/Lenovo/projects/qling/src/tui/streaming-tui.ts#L2020) 中：
     - 若 chunk 中包含 `\x7f`、`\x08` 或其它 C0 控制字符（除 `\r`/`\n`/`\t` 外），**不走** `insertBulkText` 粘贴快路，而是走按键序列循环处理。
     - 在按键循环期間，引入对标 `grok-build` `drain_and_process` 的**单批次输入合并重绘机制（Batch Input Coalescing）**：当一个 `chunk` 内包含多个连续按键（如连发的 `\x7f\x7f\x7f\x7f` 或 `\x08\x08`）时，批量更新 `InputBuffer` 状态，仅在批次结束时执行**一次** `redrawInput()` / `syncCursor()`，消除连发退格时的渲染阻塞与堆积。
   - 同时支持 `seq === "\x7f" || seq === "\x08"` 触发 `handleBackspace()`（对标 `textarea.rs` 同时处理 `\u{007f}` 与 `\u{0008}`）。
3. **Code-Point / Grapheme 级退格与光标移动**：
   - 在 [`InputBuffer`](file:///C:/Users/Lenovo/projects/qling/src/tui/input-buffer.ts) 中提供 `prevAtomicBoundary(value, index)` 与 `nextAtomicBoundary(value, index)`（使用 `Intl.Segmenter` grapheme 边界或 Unicode code point 回退，对标 `textarea.rs` `prev_atomic_boundary` / `next_atomic_boundary`），用于 `backspace()`、`deleteAfterCursorChar()`、`moveLeft()`、`moveRight()`。
4. **折行器零宽/控制字符宽度修正**：
   - 在 [`wrapFullscreenInput`](file:///C:/Users/Lenovo/projects/qling/src/tui/fullscreen.ts#L243) 中，将 `Math.max(1, stringWidth(char))` 修正为 `Math.max(0, stringWidth(char))`，与 [`StreamUI.wrapInputVisualLines`](file:///C:/Users/Lenovo/projects/qling/src/tui/streaming-tui.ts#L1350) 保持一致，防止 0 宽字符导致计算出的光标列偏右。

### 3.2 全屏模式鼠标拖选复制性能优化设计（对应 `fullscreen.ts` / `streaming-tui.ts`）

1. **鼠标事件流批处理合并（Mouse Drag Coalescing，对标 `event_loop.rs`）**：
   - 新增辅助函数 `coalesceMouseEvents(events: FullscreenMouseEvent[]): FullscreenMouseEvent[]` 并在 [`StreamUI.setupInput`](file:///C:/Users/Lenovo/projects/qling/src/tui/streaming-tui.ts#L1994) 及 `FullscreenRenderer` 中使用：当同一个 chunk 内存在连续多个 `drag` 事件时，仅保留最后一个 `drag` 位置（保留所有 `down` 和 `up` 事件边界），避免单个数据包内重复计算与重绘。
2. **Selection Head 无变化短路 + 边缘自动滚动节流（对标 `selection.rs` & `textarea.rs`）**：
   - 在 [`FullscreenRenderer.handleMouse`](file:///C:/Users/Lenovo/projects/qling/src/tui/fullscreen.ts#L566-L623) 中：
     - `drag` 事件先检查边缘滚动节流（`lastDragScrollAt`，最小间隔 50ms，对标 `textarea.rs` `drag_scroll_interval`），并且边缘滚动只更新 `this.scrollOffset` 而不单独调用 `this.render()`，与后续的 `selectionHead` 更新合并为最多一次 `render()`。
     - 若 `point` 与当前 `this.selectionHead` 相同（`compareSelectionPoint(prevHead, point) === 0`）且 `scrollOffset` 未发生变化，直接返回 `false`，**不触发 `this.render()`**（对标 `selection.rs` `InputOutcome::Unchanged`）。
3. **条目级与 Body 级宽度缓存（消除双倍 `buildBody` 与重复 Markdown 解析，对标 `scrollback` 缓存）**：
   - 为每条 `Entry` 缓存其在指定 `width`、`expandThinking`、`expandToolOutput` 下的渲染行 `styledLines` 与去 ANSI 后的 `plainLines`。流式更新最后一条 `Entry` 时仅使该条目的缓存失效。
   - 缓存整个 `body`（按 `(width, bodyRevision, expandThinking, expandToolOutput, transientOutput, progress, overlay)` 索引）及其对应的 `plainLines`。
   - 优化 [`compose()`](file:///C:/Users/Lenovo/projects/qling/src/tui/fullscreen.ts#L947-L951) 中的滚动条宽度探测：当条目或状态未变（如鼠标拖选、滚动、输入框光标移动）时，直接命中缓存的 `body` 和 `logicalBodyPlain`，实现 **O(1) 级 Body 复用**；即使首次构建需要判断 `showScrollbar`，也可通过缓存避免无谓重算。
4. **单帧输出缓冲合并（Single-Write Frame Flush）**：
   - 在 [`FullscreenRenderer.render`](file:///C:/Users/Lenovo/projects/qling/src/tui/fullscreen.ts#L1039-L1060) 中，将所有发生变化的行重绘指令与最终光标定位指令拼接为单个字符串后调用一次 `this.writeRaw(frameBuffer)`，消除逐行 I/O 抖动。

---

## 4. 验证标准

1. **单元测试与回归测试**：
   - `tests/unit/input-buffer.test.mjs`：验证退格/前进删除对 ASCII、中文、Emoji 代理对、控制字符过滤的正确性。
   - `tests/unit/tui-fullscreen.test.mjs`：
     - 验证长按退格（如连续发送 `"\x7f\x7f\x7f"`、 `"\x08\x08"`）在 `StreamUI` / `FullscreenRenderer` 中正确向左删除字符且光标绝不右移。
     - 验证鼠标连续 `drag` 事件合并：同一位置重复 `drag` 零重绘、同一批次多个 `drag` 仅重绘一次、拖选期间 Markdown 不会重复解析、松开鼠标立即复制。
2. **全量构建与测试验证**：
   - 执行 `npm run build` 与相关单元测试全部通过。
