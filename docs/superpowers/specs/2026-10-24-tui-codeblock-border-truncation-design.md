# Qling TUI 代码块顶栏最右侧残缺 `[…` 乱码修复设计文档

- **日期**: 2026-10-24
- **仓库**: `C:\Users\Lenovo\projects\qling`
- **状态**: Approved for implementation

## 1. 现象与根因分析

用户反馈截图（`微信图片_20261024172012_95_9.png`）中，在终端渲染代码块（例如目录列表）时，顶部分隔线最右侧出现了残缺的小中括号乱码 `[...`（`┌──────... […`），且顶部分隔线变成了亮白色（底部分隔线为正常的暗灰色 `└──────...`）。

### 数学根因定位（`src/tui/markdown.ts` 第 313–326 行）

在 `formatMarkdownForTerminal(text, { width })` 中：
1. 原代码对代码块开始行 ` ``` ` 的处理为：
   ```ts
   const lang = line.trim().slice(3).trim() || "code";
   const border = "─".repeat(Math.max(10, width - 4));
   resultLines.push(DIM(`  ┌${border} [${lang}]`));
   ```
2. 宽度溢出计算：
   - 底部分隔线 `"  └" + "─".repeat(width - 4)` 的可视宽度为 `3 + (width - 4) = width - 1 <= width`。
   - 顶部分隔线在 `"  ┌" + "─".repeat(width - 4)` 之后又额外拼接了 `" [" + lang + "]"`，导致总可视宽度变为 `width + 2 + sw(lang)`（当 `lang = "code"` 时为 `width + 6`）。
   - 在全屏 TUI 结果框（`src/tui/fullscreen.ts` 第 846、917 行）中，`bodyWidth = width - 6`，而外层结果框调用 `fit(line, width - 4)`（即 `bodyWidth + 2`）。
   - 因为顶部分隔线宽度 `bodyWidth + 6` 超过了 `bodyWidth + 2` 恰好 4 列，`fit()` 触发超宽截断：
     1. 剥离了整行的 `DIM(...)` ANSI 样式（导致顶栏由暗灰变亮白）；
     2. 在 `"  ┌" + border + " ["` 处截断并追加 `"…"`，把末尾的 `" [code]"` 截成了 `" […"`。

## 2. 修复设计

在 `src/tui/markdown.ts` 的 `formatMarkdownForTerminal` 中：
1. **无语言标记的围栏块（` ``` `）不附加冗余标签**：
   - 当 `line.trim().slice(3).trim()` 为空时，顶栏直接渲染为 `DIM("  ┌" + "─".repeat(span))`，与底栏 `DIM("  └" + "─".repeat(span))` 完全对称，右侧不再出现任何多余括号。
2. **带语言标记的围栏块（如 ` ```python `）内嵌在左侧且严格守恒宽度**：
   - 当显式指定了语言 `rawLang` 时，将其内嵌在顶栏左端：`  ┌─ ${safeLang} ─────...`，并根据 `sw(safeLang)` 扣减右侧 `─` 的重复次数，保证整行可视宽度恒等于 `3 + span`（即 `width - 1 <= width`），永远不会触发外层 `fit()` 的截断与 ANSI 剥离。
3. **跨折行的行内 Markdown 语法（如 `**加粗**`、`` `代码` ``）先渲染再按可见宽度折行**：
   - 原逻辑 `wrapVisibleText(line, width).map(renderInline)` 先按纯文本折行再逐行匹配正则，导致当 `**大盘权重...收红**` 跨行时首尾 `**` 被拆在两行，无法匹配并原样泄漏 `**`。
   - 改为先执行 `renderInline`，并使 `wrapVisibleText` 识别零宽 ANSI SGR 序列并在跨行处自动闭合/续接当前激活的 ANSI 样式，消除跨行 `**` 裸露。

## 3. 验证计划

1. 在 `tests/unit/tui-markdown.test.mjs` 中新增单元测试：
   - 验证无语言标记 ` ``` ` 与带语言标记 ` ```javascript ` 的代码块顶栏、底栏可视宽度均严格 `<= width` 且顶栏与底栏总宽度一致。
   - 验证顶栏末尾绝不出现残缺的 `[…` 或未闭合括号，且保留 `DIM` 样式。
2. 重新编译 `npm run build` 并运行测试确认全部通过。
