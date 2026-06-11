# TUI Multiline Line Navigation Spec

## 背景

qling TUI 已支持 `Ctrl+N` 插入多行 prompt，但光标只能左右、首尾、按词移动。编辑多行 prompt 时，用户无法像常见编辑器/readline 一样在相邻行之间保持列位置移动，长 prompt 修订仍不够顺。

参考 `XiaomiMiMo/MiMo-Code` 的 TUI 思路：文本输入区应有独立编辑快捷键，并且历史导航只在输入区边界触发。本次只借鉴这一交互原则，不迁移 MiMo-Code 的 opentui/keybind 配置层，保持 qling 当前实现低风险、local-first。

## 目标

- 支持在多行输入内按列上下移动光标。
- 默认绑定 `Alt+Up` / `Alt+Down`，兼容常见 `Ctrl+Up` / `Ctrl+Down` CSI 序列。
- 移动只作用于本地输入缓冲，不提交、不清空、不持久化。
- 目标行短于当前列时，光标落到目标行末尾。
- 在第一行向上、最后一行向下时 no-op。
- `/shortcuts` 帮助同步真实行为。

## 非目标

- 不重写终端多行渲染模型。
- 不改变 `Up/Down` 的历史导航行为。
- 不改变 `Ctrl+N` 换行、Enter 提交、历史草稿恢复。

## 验收标准

- `InputBuffer.moveLineUp()` 和 `moveLineDown()` 在多行输入中按列移动。
- 跨不同长度行时正确夹到目标行末尾。
- TUI handler 和 raw stdin 分发均不提交输入。
- 定向测试和完整 CI 通过。
