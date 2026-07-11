# 轻灵交互韧性与自适应失败恢复 Spec

## Goal

将分散在 AgentLoop、验证、自愈、审批、TUI 和后台任务中的失败处理统一为可观测、可停止、可恢复的本地执行生命周期，避免相同错误反复消耗 turn/token。

## Execution Contract

- run 状态：`queued | running | awaiting_approval | recovering | paused | succeeded | failed | canceled`。
- started 事件必须且只能对应一个 terminal event。
- 失败类别、指纹、进展快照和恢复预算均为结构化数据。
- Provider transport retry 最多 3 次，不计入策略预算；同因最多 2 次，任务策略最多 4 次。
- 同一指纹连续两次且 diff/test/todo 均无变化时暂停为 `no_progress`。
- 审批、权限和 sandbox 失败不进行盲目模型重试。

## Interaction Contract

- TUI 通过 execution events 展示阶段、尝试、失败类别、进展和剩余预算。
- paused 状态提供 `R/S/E/C` 与 `/recover` 等价入口。
- recovery action bar 激活且草稿为空时才拦截按键。
- 所有失败输出使用原因、已尝试、证据、下一步和边界五段式结构。

## Persistence And Privacy

- 脱敏摘要写入 `~/.qling/runs/<session>/<run>.jsonl`。
- 不保存完整 prompt、模型思考、工具正文、环境变量或 secret。
- 保留 30 天且总量不超过 50 MiB。
- `/trace` 与 Dashboard 只读取摘要事件。

## Compatibility

- SessionTask 只新增可选恢复字段；旧任务按零失败加载。
- `/verify`、checkpoint、rewind、mission、session 和 memory 格式保持兼容。
- 保持非全屏 TUI，不引入新前端/TUI 框架。
