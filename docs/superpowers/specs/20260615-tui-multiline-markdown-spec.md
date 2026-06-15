# 轻灵 TUI 多行输入与 Markdown 表格渲染增强设计规范 (2026-06-15)

## 1. 目标与背景

轻灵在命令行 TUI 环境下存在两个较显眼的影响用户体验的问题：
1. **多行与长文本输入容易被打碎成多次任务队列**：由于终端默认粘贴或输入容易将换行解析为回车直接提交，导致多行长文本被按行分拆，触发大量的自愈或重复 Agent 回答队列。
2. **Markdown 表格/列表在终端中渲染粗糙且易错位**：对中文等双倍宽字符处理不当，导致表格在显示时右侧边框严重错位，排版不美观。

本设计规范针对上述问题进行系统化增强，要求：
- **Enter** 依然用于发送，**Ctrl+N** 用于插入换行；
- 引入 **“非 bracketed 粘贴保护”**，当检测到单次 chunk 包含换行且不在 bracketed 粘贴状态时，视作多行粘贴草稿，避免触发多次队列发送；
- 输入框支持 **视觉软换行（soft-wrap）** 和 **可视高度裁剪（scroll-window）** 滚动，在超过 5 行时显示顶部/底部三角指示器并告知当前行数，保持底边框完整；
- 抽出专用的 **终端 Markdown 渲染器**，支持列表、标题、代码块和对齐对无损的 Markdown 表格，表格使用 `string-width` 精确对齐，提供裁剪保护。

---

## 2. 详细设计

### 2.1 粘贴保护与多行输入

#### 2.1.1 键盘输入重构
- 在 `src/tui/streaming-tui.ts` 的 `setupInput()` 中，当 `chunk` 写入 `dataHandler` 时：
  - 如果当前没有处于 `bracketedPaste` 模式，且 `chunk` 包含 `\n` 或 `\r`：
    - 此操作判定为“非 bracketed 多行粘贴保护”。
    - 我们把 `chunk` 进行统一化换行处理（将 `\r\n` 与 `\r` 转换成 `\n`），然后对其中的每个字符进行安全插入：把 `\n` 转为 `input.insertNewline()`，其余可打印字符转为 `input.insertChar(ch)`。
    - 插入完成后，调用 `this.redrawInput()` 重新绘制，不触发提交，防止多行文本像多次 Enter 按键一样被拆分提交。

#### 2.1.2 多行草稿状态提示
- 当检测到输入缓冲区有换行（`this.input.value.includes('\n')`）或视觉软折行行数大于 1 时：
  - 在输入框下侧输出一条黄色（或者醒目颜色）提示：`多行草稿：Enter 发送全部内容`。
  - 此行提示计入 `this.lastInputHintLineCount`，确保重绘擦除时的计算完美精准。

---

### 2.2 长文本输入框软换行与滚动窗口

#### 2.2.1 软折行算法 (`wrapInputVisualLines`)
在 `src/tui/streaming-tui.ts` 或其辅助工具中引入以下处理：
```typescript
interface WrappedInput {
  lines: string[];      // 软折行后的每一行文本（不含前缀）
  cursorRow: number;    // 光标所在的视觉行 index (从 0 开始)
  cursorCol: number;    // 光标在该行中的可视宽度偏移 (按 string-width 计算)
}
```
- 输入参数为 `(value: string, width: number, cursor: number)`。
- 折行时按字符遍历：
  - 维持 `lines = [""]` 和当前视觉列宽 `currentWidth`。
  - 如果字符 index 等于 `cursor`，记录当前光标所在的视觉行号与可视偏移宽度。
  - 遇到 `\n`，物理换行，在 `lines` 中推入新空行，重置 `currentWidth`，物理字符数加 1。
  - 普通字符：取得可视宽度 `w = stringWidth(ch)`。如果 `currentWidth + w > width`，则软换行，在 `lines` 中推入空行，重置 `currentWidth`。随后插入字符，累加可视宽度，并按字符物理长度累加字符数。
  - 遍历结束后，若字符 index 等于 `cursor`，再次记录光标。

#### 2.2.2 滚动视窗与裁剪指示
- 可视高度最大值定义为 `MAX_INPUT_BOX_HEIGHT = 5`。
- 如果折行后的总视觉行数 `lines.length > 5`：
  - 定义窗口的开始行 `startRow`（以 0 为基准）。
  - 根据光标位置 `cursorRow` 自适应滚动：
    - 若 `cursorRow < startRow`，则 `startRow = cursorRow`。
    - 若 `cursorRow >= startRow + 5`，则 `startRow = cursorRow - 4`。
    - 确保 `0 <= startRow <= lines.length - 5`。
  - 选出渲染的 5 行行切片：`visibleLines = lines.slice(startRow, startRow + 5)`。
  - 动态改变边框：
    - 如果 `startRow > 0`，顶边框格式化为：`┌─── ▲ 更多内容 (当前第 ${cursorRow + 1} 行) ───┐`；
    - 如果 `startRow + 5 < lines.length`，底边框格式化为：`└─── ▼ 更多内容 (共 ${lines.length} 行) ───┘`；
    - 否则保持普通的直角框。
  - 这保证了裁剪显示时顶底边框的绝对宽度、结构和美观度，且不会影响其底部的 slash 补全面板。

---

### 2.3 纯终端 Markdown 表格与结构渲染

#### 2.3.1 提取终端 Markdown 渲染器 (`src/tui/markdown.ts`)
- 导出的主接口：
  - `formatMarkdownForTerminal(text: string, options: { width: number }): string[]`：将 Markdown 文本转换成用于终端安全输出的 ANSI 着色物理行数组。
  - `parseMarkdownTable(lines: string[]): ParsedTable | null`：安全判断并解析 Markdown 表格。如果是有效表格，返回表头和数据单元格；否则返回 `null`（原样降级输出，不干扰日志等包含 `|` 的常规文本）。

#### 2.3.2 表格列宽自适应分配与中文宽度对齐
- 表格的最大内容总列宽为 `availWidth = terminalWidth - (3 * colCount + 1)`。
- 先计算每列的实际最大内容宽度。
- 若总最大宽度超过 `availWidth`，则对各列按比例压缩宽度，但限制每列的最小宽度为 4。
- 对每个单元格内的文本进行格式化和对齐：
  - 使用 `string-width` 精确度量当前字符可视长度。
  - 超出列宽部分裁剪并在末尾替换为 `…`，宽度不足时补齐空格，确保返回的每个 cell 的 `string-width` 严格等于分配的列宽，完全杜绝错位。

---

## 3. 兼容性与非功能性要求
- **输入法与光标兼容性**：不改变 `StreamUI` 的 `syncCursor`、物理 backspace 等行为。
- **降级保护**：当文本无法解析为合法 GFM 表格时，作为普通文本行进行降级输出，不误把包含单个或多个 `|` 的日志原文截断或强行表格化。
- **无新增依赖**：不引入 Ink、React TUI 或 Blessed，仅使用自带的 `string-width` 等轻量级包进行字符宽度计算，确保包依赖审计（`npm audit`）高分通过。
