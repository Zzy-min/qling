# 轻灵 TUI 输入区简洁化规格

## 背景

当前 TUI 在每次恢复输入框前会输出完整 statusline 和一长串快捷键提示。长会话中这两行反复堆叠在输入框上方，信息密度过高，影响界面美观和输入聚焦。

## 目标

- 默认 prompt 区域只保留一行简洁操作提示。
- 不再在输入框正上方重复输出完整 `model=... session=... tokens=...` 状态串。
- TUI 欢迎卡片不再输出 `3 步开始` 与 `常用入口` 两行。
- 详细运行态仍通过 `/statusline`、顶部状态带和相关本地报告查看。
- 不改变输入框、slash 面板、多行草稿、光标、历史、Enter/Ctrl+N/Ctrl+C 等交互语义。

## 行为

- `printInputBar()` 和 `showPrompt()` 不直接打印原始 statusline。
- 输入框上方只显示：
  - `Enter 发送 · / 打开命令面板 · Ctrl+N 换行 · Ctrl+C 清空/中断 · /statusline 详情`
- `formatWelcomeGuide()` 只输出工作台标题、模型/工作区、记忆/权限、最近会话；不输出重复的新手引导和常用入口清单。
- `setStatusLine()` 和 `setStatusLineEnabled()` 保留，供命令状态、报告和未来配置使用，不破坏 API。
- `/statusline` 命令继续负责展示完整状态线详情。

## 非目标

- 不重做全屏 TUI。
- 不引入新依赖。
- 不改变状态线命令和状态数据结构。
- 不修改 session/memory/token 存储格式。
