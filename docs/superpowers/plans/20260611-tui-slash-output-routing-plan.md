# TUI Slash Output Routing Plan

## 步骤

1. 添加 TUI 单元测试：构造可替换 UI recorder，验证 `/sessions` 的 slash 输出通过 UI 捕获，并且不触发 `console.log`。
2. 添加错误通道覆盖：直接调用 `createSlashContext().writeError()`，验证错误输出进入 UI。
3. 在 `StreamUI` 中增加通用 `appendOutput(text)`，按多行追加命令输出。
4. 修改 `StreamingREPL.createSlashContext()`，将 `writeLine` 路由到 `ui.appendOutput()`，将 `writeError` 路由到 `ui.appendError()`。
5. 运行定向测试、完整 CI、旧名扫描、diff/audit 检查后提交并推送。

## 风险

- 某些 slash 命令依赖空行排版；`appendOutput` 必须保留空行。
- 单元测试替换的是私有字段；现有测试已采用该方式，本次沿用以避免重构过大。
