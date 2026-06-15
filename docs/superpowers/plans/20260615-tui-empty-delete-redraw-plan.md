# 轻灵 TUI 空输入 Delete 清屏回归修复计划

## Steps

1. 增加 RED 测试：空输入状态下 `printInputBar()` 后触发 Delete，断言不会使用从内容行上移 2 行再清屏的序列。
2. 修复 `moveToInputContentStart()`：当光标锚点是当前行时，只上移到输入框顶边框，即 `lastInputCursorLineIndex - 1`。
3. 跑定向测试：`npm run build && node --test tests\unit\streaming-tui-ctrl-c.test.mjs tests\unit\tui-shell.test.mjs`。
4. 跑完整验证：`npm run ci:check`、旧名扫描、`git diff --check`、`npm audit`。
5. 提交并推送。

## Non-goals

- 不重写 TUI 渲染系统。
- 不改变 Delete、Backspace、Ctrl+L、Enter、Ctrl+N 的用户语义。
