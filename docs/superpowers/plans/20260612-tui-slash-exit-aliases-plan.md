# TUI Slash Exit Aliases Plan

## 步骤

1. 扩展 streaming REPL 队列测试 recorder，使退出路径可安全调用 `stop()`。
2. 添加 `/exit` 测试：确认本地关闭、无 prompt processing、无 input history。
3. 添加中文 `/退出` 测试：确认同样走本地关闭路径。
4. 在 `StreamingREPL` 中抽出本地退出命令判断，覆盖裸命令和 slash 别名。
5. 运行定向测试、完整 CI、旧名扫描、audit、diff 检查后提交并推送。

## 风险

- `close()` 会调用 UI `stop()`，测试 recorder 必须覆盖该方法以避免把测试替身缺口误判为业务失败。
- 退出命令应在 slash registry 前处理，否则仍会显示未知 slash command。
