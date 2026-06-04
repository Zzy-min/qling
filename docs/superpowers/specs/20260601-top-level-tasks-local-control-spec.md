# 顶层任务控制面 `qling tasks`

## Summary
- 新增顶层本地命令 `qling tasks list|cancel` 与中文别名 `qling 任务 ...`。
- 目标是让用户不用进入当前 TUI session，也能查看和停止本机已持久化的 `/loop` 任务。
- 命令只访问 `<stateDir>/session-tasks/*.json`，不读取 session 正文、不联网、不调用模型。

## Public Interface
- `qling tasks`
- `qling tasks list`
- `qling tasks list [count]`
- `qling tasks cancel <taskId>`
- `qling 任务`
- `qling 任务 列表 [count]`
- `qling 任务 取消 <taskId>`

## Behavior
- `tasks` 无子命令等价于 `tasks list`。
- `list` 默认展示最近 20 个任务，最多 100 个，非法 count 回退到 20。
- 列表按 `updatedAt` 倒序，其次按 `createdAt` 倒序。
- 输出固定包含：session、任务 ID、状态、runner、pending、间隔、下次执行、上次执行、更新时间、Prompt 摘要。
- Prompt 摘要最多 80 个字符，只来自 task 元数据，不读取 session 快照正文。
- 缺失目录、空目录、空任务文件都正常退出，提示可用 `/loop` 创建任务。
- `cancel <taskId>` 仅修改包含该任务的本地 task JSON 文件，把状态置为 `canceled` 并清除 `pending`。
- `cancel` 找不到任务时返回非零错误；已取消任务重复 cancel 应保持幂等并输出当前状态。

## Non-Goals
- 不删除任务文件。
- 不执行、恢复或修改 prompt。
- 不读取 `<stateDir>/sessions` 会话正文。
- 不依赖 daemon 存活状态；daemon 继续通过同一状态文件观察取消结果。
- 不引入网络、模型调用或远端同步。

## Acceptance
- parser 能识别 `tasks` 和 `任务` 为管理命令并保留后续参数。
- help 展示英文主命令和中文别名。
- 单元测试覆盖缺失目录、排序、count 截断、取消持久化和未读取 session 正文。
- smoke 测试覆盖 `qling tasks list` 和 `qling 任务 取消 <id>` 的顶层执行。
- `npm run ci:check` 通过。
