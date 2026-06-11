# TUI Delete Next Word Plan

## 步骤

1. 在 `tests/unit/input-buffer.test.mjs` 为 `deleteWordAfterCursor()` 写 RED 测试。
2. 在 `tests/unit/streaming-tui-ctrl-c.test.mjs` 写 TUI handler 和 raw stdin 分发测试。
3. 实现 `InputBuffer.deleteWordAfterCursor()`。
4. 在 `StreamUI` 增加 `handleAltD()` 并分发 `\x1bd`、`\x1b[3;5~`、`\x1b[3;3~`。
5. 更新 `src/shortcuts.ts` 中按词删除说明。
6. 运行定向测试、完整 CI、旧名扫描、安全审计、diff/staged 检查，然后提交推送。

## 风险控制

- 保持默认编辑模型：删除操作只改内存中的输入缓冲。
- 不引入终端重排，只复用现有 `redrawInput()`。
- 避免抢占已有快捷键：`Alt+D` 和 `Ctrl+Delete` 当前未被使用。
