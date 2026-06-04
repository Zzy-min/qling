# `/agents` 会话内后台任务视图规格（2026-06-01）

## 背景

轻灵已经提供顶层 `qling agents`，可以按状态分组查看后台 mission。但用户在 TUI 长会话中仍需要退出或另开终端才能查看后台任务，这不符合 Claude Code 类“会话内随时掌握并行工作”的交互体验。

## 目标

- 新增 slash command `/agents`，中文别名 `/代理`。
- 在当前 TUI 会话内展示本地后台 mission 分组视图。
- 复用现有 `renderAgentsView()` 输出格式，保持顶层命令和会话内命令一致。
- 只读取本地 mission 元数据与任务描述摘要。
- 不调用模型、不联网、不连接 daemon、不读取会话正文、不写入状态。

## 非目标

- 不新增 mission 控制动作。
- 不实现实时 attach 或交互式接管。
- 不读取 mission event 日志正文。
- 不实现 Dashboard 前端。

## 行为

- `/agents` 从当前 runtime state dir 的 `missions/` 读取 mission 快照并分组输出。
- `/代理` 与 `/agents` 行为一致。
- 无 mission 时显示空分组，不报错。
- `/help` 展示 `/agents, /代理`。
- 如果当前上下文无法提供 runtime state dir，则降级到默认本地 state dir。

## 验收

- slash 单测覆盖 `/help` 包含 `/agents`。
- slash 单测覆盖 `/agents` 能读取临时 state dir 中的 mission。
- slash 单测覆盖 `/代理` 与英文命令行为一致。
- 输出不包含 session message 正文。
- `npm run build`、目标测试、chat smoke 和 `npm run ci:check` 通过。
