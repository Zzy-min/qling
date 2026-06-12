# TUI History Search Feedback Plan

## 步骤

1. 添加 TUI 单元测试：预置历史、输入无匹配查询、触发 `handleHistorySearch()`，断言提示、输入和提交状态。
2. 修改 `StreamUI.handleHistorySearch()`，读取 `InputBuffer.searchHistory()` 返回值。
3. 未命中时在本地输出一条简短提示，然后重绘当前输入并同步光标。
4. 更新 `/shortcuts` 说明，明确 `Ctrl+R` 未命中会保留草稿。
5. 跑定向测试、完整 CI、旧名扫描、audit、diff 检查，提交并推送。

## 风险

- 提示输出不能覆盖或丢失当前输入栏。
- 空输入且历史为空时也应显示反馈，但不能提交 `exit` 或空命令。
