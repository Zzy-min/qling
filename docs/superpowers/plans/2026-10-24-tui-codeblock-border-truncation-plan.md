# Qling TUI 代码块顶栏最右侧残缺 `[…` 乱码修复实施计划

- **日期**: 2026-10-24
- **设计文档**: `docs/superpowers/specs/2026-10-24-tui-codeblock-border-truncation-design.md`

## 步骤清单

1. **修改 `src/tui/markdown.ts`**
   - 修正 `formatMarkdownForTerminal` 中代码块起始边框宽度计算：
     - 无语言标记时渲染 `  ┌───...`（不追加 `[code]`）；
     - 有语言标记时内嵌在左侧 `  ┌─ lang ───...` 并扣减 `─` 数量，确保总可视宽度恒等于底栏宽度（`<= width`）。
2. **补充单元测试 `tests/unit/tui-markdown.test.mjs`**
   - 覆盖无语言代码块与有语言代码块在窄宽度/常规宽度下的可视宽度守恒，以及置入全屏结果框 `fit()` 后不产生 `[…` 截断。
3. **构建与验证**
   - 执行 `npm run build` 与 `node --test tests/unit/tui-markdown.test.mjs tests/unit/tui-fullscreen.test.mjs`。
