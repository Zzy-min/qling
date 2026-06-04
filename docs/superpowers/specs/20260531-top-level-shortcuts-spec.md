# `qingling shortcuts` 顶层快捷键帮助规格（2026-05-31）

## 背景

轻灵已在会话内提供 `/shortcuts` 和 `/快捷键`，用于查看 TUI 输入快捷键。但用户在进入 TUI 前也需要了解如何输入多行 prompt、搜索历史、清空输入等基础交互，否则首次使用体验不够顺滑。

## 目标

- 新增顶层命令 `qingling shortcuts`。
- 新增中文别名 `qingling 快捷键`。
- 顶层命令复用 `/shortcuts` 的文案，避免 shell 与 TUI 帮助漂移。
- 在 `AgentLoop` 初始化前执行并退出，不要求 API key/provider 可用。
- 输出只包含本地 TUI 快捷键说明，不读取本地会话正文、不联网、不调用模型。

## 非目标

- 不改变快捷键实际按键行为。
- 不新增交互式教学流程。
- 不持久化历史、不读取历史正文。
- 不改变 `/shortcuts` slash command 行为。

## 行为

- `qingling shortcuts` 输出“ TUI 快捷键”并以 exit code 0 退出。
- `qingling 快捷键` 等价于 `qingling shortcuts`。
- `qingling --help` 展示英文主命令和中文别名。
- 与 `--continue` 或 `--resume` 组合时报模式冲突错误，保持管理命令一致性。

## 验收

- 单测覆盖 `shortcuts` 与 `快捷键` 顶层解析。
- 单测覆盖 help 文案包含 `qingling shortcuts` 和 `快捷键`。
- smoke 覆盖 `qingling 快捷键` 可直接退出并输出快捷键帮助。
- `npm run build`、相关测试和 `npm run ci:check` 通过。
