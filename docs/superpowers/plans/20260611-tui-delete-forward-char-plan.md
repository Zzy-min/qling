# TUI Delete Forward Character Plan

## 步骤

1. 在 `tests/unit/input-buffer.test.mjs` 添加 `deleteAfterCursorChar()` 的 RED 测试。
2. 在 `tests/unit/streaming-tui-ctrl-c.test.mjs` 添加 TUI handler 与 `ESC [ 3 ~` raw stdin 分发测试。
3. 在 `InputBuffer` 实现删除光标后单字符。
4. 在 `StreamUI` 绑定 Delete 序列并复用 `redrawInput()`。
5. 更新 `src/shortcuts.ts` 帮助文案。
6. 运行定向测试、完整 CI、旧名扫描、安全审计、diff/staged 检查，提交并推送。

## 风险控制

- 不占用已有 `Ctrl+Delete` 词删除序列。
- 不改变 Backspace 或 `Alt+D` 语义。
- 删除动作只改内存中的 `InputBuffer`，不会写磁盘或触发模型请求。
