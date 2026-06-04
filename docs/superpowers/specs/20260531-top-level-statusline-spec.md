# `qling statusline` 顶层状态线规格（2026-05-31）

## 背景

轻灵已提供会话内 `/statusline`，用于展示模型、session、分支、权限、目标、任务和 token 状态。但用户在进入 TUI 前也需要快速确认当前配置解析后的本地状态，例如模型、workspace 分支和权限模式。

## 目标

- 新增顶层命令 `qling statusline`。
- 新增中文别名 `qling 状态线`。
- 在 `AgentLoop` 初始化前执行并退出，不要求 API key/provider 可用。
- 复用现有状态线格式：`model/session/branch/perm/goal/tasks/tokens`。
- 顶层模式无活动会话时使用安全占位：`session=-`、`goal=none`、`tasks=0`、`tokens=0`。
- 保持只读本地边界：只读取配置和 workspace git HEAD，不读取会话正文、不联网、不调用模型。

## 非目标

- 不切换 `/statusline on|off` 状态。
- 不创建或恢复 session。
- 不读取 saved session 正文。
- 不改变会话内 `/statusline` 行为。

## 行为

- `qling statusline` 输出紧凑状态线并以 exit code 0 退出。
- `qling 状态线` 等价于 `qling statusline`。
- 支持全局 `--workspace`、`--model` 和配置中的默认权限模式。
- `qling --help` 展示英文主命令和中文别名。
- 与 `--continue` 或 `--resume` 组合时报模式冲突错误，保持管理命令一致性。

## 验收

- 单测覆盖 local statusline snapshot 使用配置模型、权限模式和 git branch。
- 单测覆盖 `statusline` 与 `状态线` 顶层解析。
- 单测覆盖 help 文案包含 `qling statusline` 与 `状态线`。
- smoke 覆盖 `qling 状态线` 可直接退出并输出本地状态线。
- `npm run build`、相关测试和 `npm run ci:check` 通过。
