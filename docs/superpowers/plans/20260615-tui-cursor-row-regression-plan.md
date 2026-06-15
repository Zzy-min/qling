# 轻灵 TUI 光标行错位回归修复计划

## Steps

1. 增加回归测试：捕获 `printInputBar()` 输出的 ANSI 光标移动序列，断言从底边框回到首行内容时只上移 1 行。
2. 修复 `inputCursorPosition()`：可见内容行的行号从 `2 + visualCursorRow` 开始，跳过顶边框。
3. 跑 RED/GREEN 定向验证：`npm run build && node --test tests\unit\streaming-tui-ctrl-c.test.mjs`。
4. 跑完整验收：`npm run ci:check`、旧名扫描、`git diff --check`、`npm audit`。
5. 提交并推送。

## Non-goals

- 不改输入框视觉样式。
- 不重构光标系统。
- 不改变 slash completion、history、Enter/Ctrl+N 语义。
