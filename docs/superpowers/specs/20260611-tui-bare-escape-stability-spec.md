# TUI Bare Escape Stability Spec

## 背景

qling TUI 已支持大量终端 escape 序列，例如方向键、Home/End、Delete、按词移动和多行移动。但单独按下 `Esc` 时，当前解析器会把它保存在 `partial` 中等待后续字符。若用户只是误触 `Esc`，后续输入可能被当作未知 escape 序列的一部分处理，造成不稳定的输入体验。

## 目标

- 单独收到裸 `Esc` 时立即作为本地 no-op 处理。
- 裸 `Esc` 不提交输入、不清空输入、不写入历史、不持久化。
- 裸 `Esc` 后继续输入普通字符应正常进入输入缓冲。
- 完整 escape 序列（如 `ESC[A`、`ESC[3~`、`Alt+D`）保持原有行为。
- `/shortcuts` 帮助说明 `Esc` 是本地取消当前未完成终端序列的 no-op。

## 非目标

- 不实现运行中 Agent 的热键中断。
- 不改变 `Ctrl+C` 清空/退出语义。
- 不改变方向键、Delete、Alt 组合键等现有序列。

## 验收标准

- 单独 `Esc` 后输入普通字符不会丢失或污染。
- 单独 `Esc` 不触发输入回调。
- 现有完整 escape 序列测试保持通过。
- 定向测试和完整 CI 通过。
