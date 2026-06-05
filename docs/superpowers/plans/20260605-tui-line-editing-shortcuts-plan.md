# `qling` TUI 行编辑快捷键实施计划（2026-06-05）

## 阶段 1: RED

- 为 `InputBuffer` 增加 `moveStart`、`moveEnd`、`deleteBeforeCursor`、`deleteAfterCursor` 期望测试。
- 为 `StreamUI` 增加 `Ctrl+A/E/U/K` 不提交输入的快捷键测试。

## 阶段 2: GREEN

- 在 `InputBuffer` 实现四个本地编辑方法。
- 在 `StreamUI.setupInput()` 识别 `\x01`、`\x05`、`\x15`、`\x0b`。
- 增加对应 handler，调用输入缓冲区并重绘。

## 阶段 3: VERIFY

- 运行新增/相关单测。
- 运行 `npm run build`。
- 运行 `npm run ci:check`。
- 做 `git diff --check`、`npm audit --audit-level=high`、旧名残留检查。
- 提交并推送到 `origin/main`。
