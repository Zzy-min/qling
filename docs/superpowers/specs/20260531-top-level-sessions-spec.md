# `qling sessions` 顶层本地会话列表规格（2026-05-31）

## 背景

会话内 `/sessions` 已能列出本地保存的会话快照，但用户在 shell 中排障、整理本地留存数据或准备恢复会话时，需要一个无需进入 TUI、无需 API key 的顶层命令查看本地 session 列表。

## 目标

- 新增顶层命令 `qling sessions [count]`。
- 复用本地 `SessionRegistry`，列出最近保存的会话摘要。
- 在 `AgentLoop` 初始化前执行并退出。
- 输出会话 name、session id、更新时间、turns、messages、tokens、workspace。
- 默认显示最近 20 条，最多 100 条。
- 不输出消息正文。

## 非目标

- 不恢复、删除、重命名或迁移会话。
- 不改变 `/sessions` slash command 行为。
- 不联网、不调用模型。

## 行为

- `qling sessions` 显示最近 20 条本地会话。
- `qling sessions 5` 显示最近 5 条。
- `count` 非法、小于等于 0 或缺省时使用 20；超过 100 时截断为 100。
- 支持全局 `--file-state-dir`，例如 `qling --file-state-dir <dir> sessions 5`。
- 没有会话快照时输出 `(无)` 并以 exit code 0 退出。

## 验收

- 单测覆盖 CLI parser 识别 `sessions [count]`。
- 单测覆盖 formatter 不输出消息正文。
- smoke 覆盖 `qling sessions 1` 读取临时本地会话快照并退出。
- `npm run build`、相关测试和 `npm run ci:check` 通过。
