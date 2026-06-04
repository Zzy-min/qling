# Mission 中文别名与终止别名规格（2026-06-01）

## 背景

轻灵的本地只读诊断命令已经具备中文顶层别名，但后台自治核心入口仍主要依赖英文 `mission`、`agents`、`logs` 与英文 mission 子命令。为了保持“英文主命令 + 中文别名 + 中文提示”的一致交互风格，需要把中文别名覆盖到后台 mission 管理路径，同时不改变状态机和权限边界。

## 目标

- 新增顶层中文别名：
  - `qingling 使命 ...` -> `qingling mission ...`
  - `qingling 代理` -> `qingling agents`
  - `qingling 日志 <id>` -> `qingling logs <id>`
- 新增 mission 子命令中文别名：
  - `开始` -> `start`
  - `列表` -> `list`
  - `查看` -> `show`
  - `日志` -> `logs`
  - `附着` / `跟随` -> `attach`
  - `暂停` -> `pause`
  - `恢复` -> `resume`
  - `取消` / `停止` / `终止` -> `cancel`
  - `重试` -> `retry`
- 新增英文直观别名 `terminate` -> `cancel`，贴近安全控制面语义。
- 所有别名只做 parser/子命令归一化，执行路径复用现有英文命令。
- 纯管理类命令继续在 AgentLoop 初始化前处理，保持无 API key 可用。

## 非目标

- 不新增新的 mission 状态。
- 不改变 `pause/resume/cancel/retry` 的合法状态迁移。
- 不增加删除 mission、上传日志、读取会话正文或联网能力。
- 不实现 Dashboard 前端控制面。

## 行为

- `qingling 使命 列表` 等价于 `qingling mission list`。
- `qingling 使命 终止 <id>` 等价于 `qingling mission cancel <id>`。
- `qingling mission terminate <id>` 等价于 `qingling mission cancel <id>`。
- `qingling 代理` 等价于 `qingling agents`。
- `qingling 日志 <id>` 等价于 `qingling logs <id>`。
- `qingling --help` 展示这些中文别名和 `terminate` 别名。

## 验收

- 单测覆盖顶层中文别名映射。
- 单测或 smoke 覆盖 mission 中文子命令实际可执行。
- 单测覆盖 help 文案包含 mission 中文别名和 `terminate`。
- Smoke 覆盖无 API key 下 `使命 列表`、`日志 <id>` 仍可读取本地 mission 状态/日志。
- `npm run build`、目标测试和 `npm run ci:check` 通过。
