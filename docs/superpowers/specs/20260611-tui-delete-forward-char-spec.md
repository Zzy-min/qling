# TUI Delete Forward Character Spec

## 背景

qling TUI 已支持 Backspace、`Ctrl+W`、`Alt+D` 等删除操作，但常见终端的 `Delete` 键还没有处理。用户在长 prompt 中修正中间字符时，只能移动后退再 Backspace，编辑体验不够接近成熟终端/Claude Code。

## 目标

- 支持 `Delete` 删除光标后的单个字符。
- 兼容常见终端发送的 `ESC [ 3 ~` 序列。
- 光标在输入末尾时 no-op。
- 删除只作用于本地输入缓冲，不提交、不清空、不持久化。
- `/shortcuts` 帮助同步真实行为。

## 非目标

- 不改变 Backspace 删除光标前字符的行为。
- 不改变 `Alt+D` 删除光标后一个词的行为。
- 不改变 Enter、Ctrl+N、历史搜索或粘贴行为。

## 验收标准

- `InputBuffer.deleteAfterCursorChar()` 删除光标后的单个字符。
- 光标在末尾时 `Delete` no-op。
- TUI handler 和 raw stdin 分发均不提交输入。
- 定向测试和完整 CI 通过。
