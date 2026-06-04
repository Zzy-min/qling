# `qingling` TUI 模式指示规格（2026-05-31）

## 背景

轻灵正在补齐 Claude Code 类交互体验。当前状态线已经显示 `perm=<mode>`，`/permissions` 也能查询权限策略，但裸值 `allow/ask/deny` 对用户不够直观，长会话中容易误判后续工具调用是否会自动执行。

## 目标

- 在状态线中展示可解释权限模式，例如 `perm=ask(确认)`。
- `/permissions status` 与切换结果使用同一套说明，避免状态线和命令输出含义漂移。
- 仅改变本地 UI 文案与 formatter，不改变权限判定、沙箱、hook 或工具执行行为。
- 保持状态线紧凑，适合持续显示在 prompt 前。

## 非目标

- 不新增权限模式。
- 不修改 `PermissionMatrix` 决策。
- 不持久化权限说明。
- 不实现审批 UI。

## 行为

- `allow` 显示为 `allow(自动)`。
- `ask` 显示为 `ask(确认)`。
- `deny` 显示为 `deny(拒绝)`。
- 缺失或未知模式稳定降级为 `-(未知)`。
- `/permissions status` 输出当前模式和对应说明。

## 验收

- 单测覆盖三种权限模式和缺失模式的格式化。
- `statusline` formatter 使用可解释权限文本。
- `/permissions status` 输出包含模式说明。
- `npm run build`、相关单测和 `npm run ci:check` 通过。
