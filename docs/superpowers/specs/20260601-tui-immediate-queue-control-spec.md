# TUI 即时输入队列控制规格（2026-06-01）

## 背景

轻灵 TUI 已支持长任务期间继续输入，并通过串行队列避免 AgentLoop 并发运行。但当用户连续提交多条输入后，目前只能等待队列自然 drain，缺少一个本地、即时、低风险的方式查看或清空 pending 输入。

## 目标

- 新增 TUI 即时命令 `/queue` 与中文别名 `/队列`，显示本地输入队列元数据。
- 新增 `/queue clear` 与 `/队列 清空`，清空 pending 输入。
- 命令必须在当前任务运行时立即执行，不进入输入队列等待。
- 只清空 pending 输入，不取消正在运行的输入或 AgentLoop。
- 输出只包含 running/pending/max/cleared 等元数据，不输出任何输入正文。

## 非目标

- 不实现正在运行任务的中断。
- 不删除历史记录文件。
- 不新增联网、模型调用或磁盘正文读取。
- 不改变普通输入的串行执行顺序。

## 行为

- `/queue` 输出当前队列状态：`running=<yes|no> pending=<n> max=<n>`。
- `/queue clear` 清空尚未执行的 pending 输入，并输出清空数量。
- pending 输入被清空后，对应 `handleUserInput()` 不恢复 prompt、不执行 handler。
- 当前正在执行的输入继续运行，完成后按现有逻辑恢复 prompt。

## 验收

- 单测覆盖 `SerialInputQueue.clearPending()` 清空 pending 并 resolve 为 rejected/false。
- 单测覆盖 TUI 运行中 `/queue clear` 立即清空 pending 输入。
- 单测覆盖输出不包含被清空输入正文。
- TUI smoke 与 `npm run ci:check` 通过。
