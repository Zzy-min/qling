# `qingling recap` 顶层本地回顾规格（2026-05-31）

## 背景

会话内 `/recap` 已能查看当前进程内的本地会话摘要。但用户从终端回到项目时，仍需要一个无需进入 TUI、无需启动 AgentLoop 的顶层入口，快速查看最近保存的本地会话快照，形成更接近 Claude Code 的“回来先知道上下文”的体验。

## 目标

- 新增顶层命令 `qingling recap [session|latest] [count]`。
- 新增中文别名 `qingling 回顾 [session|latest] [count]`。
- 默认读取最近保存的本地会话快照；传入 session name 或 sessionId 时读取指定快照。
- 输出会话 id、turns、tokens、compactions、workspace 和最近消息摘录。
- 默认显示最近 6 条消息，非法数量使用 6，最大 20。
- 命令只读取 `<stateDir>/sessions/*.json`，不调用模型、不联网、不写远端、不进入交互循环。

## 非目标

- 不生成 LLM 总结。
- 不扫描导出 Markdown。
- 不修改或删除本地快照。
- 不上传、不同步、不写入 memory。
- 不改变 session snapshot 文件格式。

## 行为

- `qingling recap` 等价于 `qingling recap latest`。
- `qingling recap 3` 表示查看最近快照的最近 3 条消息。
- `qingling recap latest 3` 表示查看最近快照的最近 3 条消息。
- `qingling recap <session> 3` 表示查看指定 session/name 的最近 3 条消息。
- 本地没有快照时输出空态提示，建议先完成一次交互会话或使用 `/sessions` 查看快照。
- 指定 session 不存在时输出未找到提示，不报错崩溃。

## 验收

- 单测覆盖参数解析、最近快照回顾、指定快照回顾、缺失快照空态。
- CLI parser/help 覆盖 `recap` 与 `回顾`。
- smoke 覆盖顶层 `recap` 能读取临时 state dir 中的 session 快照，且不进入 AgentLoop。
- `npm run build`、目标测试和 `npm run ci:check` 通过。
