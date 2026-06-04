# 顶层目标控制面 `qling goal`

## Summary
- 新增顶层本地命令 `qling goal status|set|clear` 与中文别名 `qling 目标 ...`。
- 目标是让用户不用进入 TUI，也能查看、设置、清除本机持久化的 session goal。
- 数据源保持本地 `<stateDir>/session-goals/*.json` 和 `<stateDir>/sessions/*.json` 摘要；不读取会话正文、不联网、不调用模型。

## Public Interface
- `qling goal`
- `qling goal status [sessionRef]`
- `qling goal set <condition>`
- `qling goal set --session <sessionRef> <condition>`
- `qling goal clear [sessionRef]`
- `qling 目标`
- `qling 目标 状态 [sessionRef]`
- `qling 目标 设置 <condition>`
- `qling 目标 清除 [sessionRef]`

## Behavior
- `goal` 无子命令等价于 `goal status`。
- `status` 无 sessionRef 时列出所有本地 goal，按 `updatedAt` 倒序。
- `status <sessionRef>` 只展示指定 session 的 goal；`latest` 表示最近保存的 session。
- `set <condition>` 默认作用于最近保存的 session，并写入 daemon runner 的 active goal，`pending=true`，便于 `qlingd` 后续推进。
- `set --session <sessionRef> <condition>` 作用于指定 session。
- `clear [sessionRef]` 默认作用于最近保存的 session，并把 goal 状态改为 `cleared`。
- condition 为空时返回用法错误。
- 没有本地 session 时，`set` 和默认 `clear` 返回明确错误，不创建孤儿 goal。
- 输出包含：session、状态、runner、pending、条件、创建时间、更新时间、评估轮次、最近原因。

## Privacy And Safety
- 不读取 session messages，也不输出会话正文。
- 不启动 daemon、不触发模型调用；只更新本地 JSON 状态。
- 不删除 goal 文件，`clear` 仅更新状态，便于审计。
- 不做批量 clear，避免误操作。

## Acceptance
- parser 能识别 `goal` 与中文 `目标` 为顶层管理命令。
- help 展示 `goal status|set|clear` 与中文别名。
- 单元测试覆盖缺失目录、status 排序、latest 解析、set 默认 latest、clear 持久化、不读取 session 正文。
- smoke 测试覆盖 `qling goal status`、`qling 目标 设置 ...`、`qling goal clear latest`。
- `npm run ci:check` 通过。
