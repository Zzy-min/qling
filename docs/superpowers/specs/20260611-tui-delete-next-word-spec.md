# TUI Delete Next Word Spec

## 背景

qling TUI 已支持 `Alt+B/F` 按词移动和 `Ctrl+W` 删除光标前一个词，但没有删除光标后的词。长 prompt 编辑时，用户需要反复按 Delete/Backspace 才能清理后续参数，体验不够接近 Claude Code/readline。

## 目标

- 支持 `Alt+D` 删除光标后的一个词。
- 兼容常见终端的 `Ctrl+Delete` CSI 序列。
- 删除只作用于本地输入缓冲，不提交、不清空、不持久化。
- 跨空白、换行时行为稳定。
- `/shortcuts` 帮助同步真实行为。

## 非目标

- 不新增 kill-ring/yank 剪贴板。
- 不改变 `Ctrl+W` 的删除前词行为。
- 不改变 Enter、Ctrl+N、历史搜索或粘贴行为。

## 验收标准

- 光标在词首时，`Alt+D` 删除当前词并保留后续空白/文本语义可预测。
- 光标在空白前时，先跳过空白再删除下一个词。
- 光标在输入末尾时 no-op。
- raw stdin 分发 `Alt+D` 和常见 `Ctrl+Delete` 序列。
- 定向单元测试和完整 CI 通过。
