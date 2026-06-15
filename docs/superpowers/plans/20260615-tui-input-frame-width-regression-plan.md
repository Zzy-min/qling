# 轻灵 TUI 输入框右侧边框分离回归修复计划

## Steps

1. 增加回归测试：渲染输入框后抽取 `┌`、`│`、`└` 行，去掉 ANSI 后使用 `string-width` 断言宽度一致。
2. 修复 `writeInputValue()` 中动态顶/底边框的总宽度参数，从 `contentWidth + 2` 改为与内容行一致的 `contentWidth + 4`。
3. 跑定向测试：`node --test tests\unit\streaming-tui-ctrl-c.test.mjs tests\unit\tui-shell.test.mjs`。
4. 跑构建与格式检查：`npm run build`、`git diff --check`。
5. 提交并推送。

## Non-goals

- 不重做 TUI 布局系统。
- 不引入全屏/alt-screen 或新 TUI 框架。
- 不改变多行输入、Ctrl+N、Enter、slash completion 的现有行为。
