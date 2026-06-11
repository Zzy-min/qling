# TUI Multiline Line Navigation Plan

## 步骤

1. 在 `tests/unit/input-buffer.test.mjs` 为 `moveLineUp()` / `moveLineDown()` 写 RED 测试。
2. 在 `tests/unit/streaming-tui-ctrl-c.test.mjs` 写 TUI handler 与 raw stdin 分发测试。
3. 实现 `InputBuffer` 的当前行/列计算和上下行移动。
4. 在 `StreamUI` 绑定 `Alt+Up/Down` 及常见 `Ctrl+Up/Down` 序列，复用 `syncCursor()`。
5. 更新 `src/shortcuts.ts` 帮助文案。
6. 运行定向测试、完整 CI、旧名扫描、安全审计、diff/staged 检查，提交并推送。

## 风险控制

- 不占用裸 `Up/Down`，避免破坏历史导航。
- 不改变输入内容，只移动 `cursorPos`。
- 不引入终端重绘重构，保持低风险。
