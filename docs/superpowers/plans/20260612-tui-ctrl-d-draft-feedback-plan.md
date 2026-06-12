# TUI Ctrl+D Draft Feedback Plan

## 步骤

1. 扩展 `streaming-tui-ctrl-c` 单元测试，断言非空输入 `Ctrl+D` 输出本地保护提示。
2. 修改 `StreamUI.handleCtrlD()`，在非空输入时输出提示、重绘输入并同步光标。
3. 更新 `/shortcuts` 说明，使用户可发现该保护行为。
4. 跑定向测试、完整 CI、旧名扫描、audit、diff 检查，提交并推送。

## 风险

- 提示输出不能破坏当前输入栏或移动光标到错误位置。
- 空输入退出行为必须保持不变，避免引入退出回归。
