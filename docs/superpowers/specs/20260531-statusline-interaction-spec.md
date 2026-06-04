# `qling` 交互体验：本地状态线规格（2026-05-31）

## 背景

目标是朝 Claude Code 的丝滑交互体验落地，同时保持稳定与数据本地留存。当前 TUI 已有流式输出、slash command、会话恢复、goal、loop、tasks，但 prompt 旁缺少一条稳定的“当前状态可见性”。

## 目标

- 在 TUI prompt 前展示本地状态线，帮助用户快速判断当前模型、会话、权限、目标、任务与 git 分支。
- 新增 `/statusline` slash command，支持查看、开启、关闭状态线。
- 提供中文别名 `/状态线`。
- 状态线只读取本地运行态与本地 git 信息，不发送任何数据到外部服务。

## 非目标

- 不做全屏 TUI 重绘，不引入复杂 curses 布局。
- 不持久化状态线历史。
- 不修改 daemon 数据模型。

## 行为

- 默认开启状态线。
- 每次 prompt 展示时，如果状态线开启，则输出一行紧凑状态：
  - `model=<model>`
  - `session=<short-session-id>`
  - `branch=<git-branch|nogit|->`
  - `perm=<allow|ask|deny>`
  - `goal=<active|none|...>`
  - `tasks=<active-count>`
  - `tokens=<approx>`
- `/statusline` 输出当前状态线内容。
- `/statusline off` 关闭后，后续 prompt 不再输出状态线。
- `/statusline on` 重新开启。
- `/状态线` 与 `/statusline` 等价。

## 验收

- 单测覆盖 `/statusline`、`/statusline off`、`/statusline on`、`/状态线`。
- 单测覆盖 formatter 对缺失字段和长 session id 的处理。
- `npm run build` 通过。
- `node --test "tests/unit/statusline.test.mjs" "tests/unit/slash-commands.test.mjs"` 通过。
- `npm run ci:check` 通过。
