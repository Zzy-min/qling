# `/mission` 会话内本地任务管理规格（2026-06-01）

## 背景

轻灵已经有顶层 `qling mission ...` 与会话内 `/agents` 视图，但用户在 TUI 中看到后台任务后，仍缺少就地查看详情、查看日志、执行安全控制动作的入口。为了接近 Claude Code 类“会话中管理后台 Agent”的体验，需要把 mission 的常用本地管理能力补到 slash commands。

## 目标

- 新增 slash command `/mission`，中文别名 `/使命`。
- 支持本地 mission 管理子命令：
  - `list`
  - `show <id>`
  - `logs <id>`
  - `pause <id>`
  - `resume <id>`
  - `cancel <id>`
  - `terminate <id>`，等价于 `cancel`
  - `retry <id>`
- 支持中文子命令：
  - `列表`
  - `查看`
  - `日志`
  - `暂停`
  - `恢复`
  - `取消`
  - `终止`
  - `重试`
- 只使用当前本地 runtime state dir 的 mission store，不连接 daemon、不联网、不调用模型。
- 复用 `MissionManager` 的状态迁移校验，不复制状态机规则。

## 非目标

- 不实现交互式 attach。
- 不启动或停止 daemon。
- 不读取 session message 正文。
- 不删除 mission 文件。
- 不绕过 `MissionManager` 状态迁移限制。

## 行为

- `/mission` 或 `/mission list` 输出与 `/agents` 同源的分组视图。
- `/mission show <id>` 输出 mission 元数据、状态、session id、时间、来源、错误和任务描述。
- `/mission logs <id>` 输出 mission event logs。
- `/mission terminate <id>` 与 `/mission cancel <id>` 行为一致。
- 控制动作成功后输出更新后的 mission 详情。
- 缺少 id 或未知子命令时输出用法错误。

## 验收

- slash 单测覆盖 `/help` 包含 `/mission`。
- slash 单测覆盖 `/mission show <id>`。
- slash 单测覆盖 `/mission logs <id>`。
- slash 单测覆盖 `/mission terminate <id>` 执行本地 cancel。
- slash 单测覆盖 `/使命 查看 <id>` 中文别名。
- 输出不包含 session message 正文。
- `npm run build`、目标测试、mission smoke 和 `npm run ci:check` 通过。
