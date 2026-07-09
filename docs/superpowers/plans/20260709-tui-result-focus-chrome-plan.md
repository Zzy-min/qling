# TUI 结果聚焦与输入区去噪计划

## 步骤

1. **shell.ts**：新增 `formatResultHighlight({ header, lines, width })` 纯函数；`formatBottomHints` 保留供帮助文案。
2. **streaming-tui.ts**：
   - `printPromptHint()` 改为空操作（不再打印 statusline / bottom hints）。
   - `appendFinal` 接入结果高亮框（`compactLong` 不适用最终答复）。
   - `appendDone` 强化完成态文案与颜色。
3. **测试**：
   - `tui-shell`：覆盖 `formatResultHighlight`；bottom hints 函数仍可单测存在。
   - `streaming-tui`：结果块含「结果」/边框；`showPrompt` 不再输出 Enter 发送提示行。
4. **验证**：`npm test`；commit + push GitHub。

## 风险

- 依赖 statusline 叠在输入框上的用户需改用 `/statusline` 或顶栏。
