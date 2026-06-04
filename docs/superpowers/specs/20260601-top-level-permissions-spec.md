# `qingling permissions` 顶层权限状态规格（2026-06-01）

## 背景

轻灵已有会话内 `/permissions`，可以查看或临时切换当前进程的工具权限默认策略。但用户在进入 TUI 或执行任务前，需要一个无需启动 AgentLoop 的顶层只读入口，明确当前权限边界、规则数量和环境变量覆盖来源，降低工具执行前的不确定性。

## 目标

- 新增顶层命令 `qingling permissions`。
- 新增中文别名 `qingling 权限`。
- 输出当前生效的 `guard.permissions.default`。
- 输出权限规则列表的数量、tool pattern、decision、reason。
- 输出环境变量覆盖提示：`QINGLING_GUARD_PERMISSIONS_DEFAULT`、`QINGLING_PERMISSIONS_MODE`。
- 输出模式说明：`allow` 自动放行、`ask` 询问确认、`deny` 默认拒绝。
- 命令只读取已加载配置和当前进程环境变量，不写配置、不修改进程权限、不启动 AgentLoop、不调用模型、不联网。

## 非目标

- 不提供顶层写入配置能力。
- 不修改 `.env`、config 文件或 runtime state。
- 不改变会话内 `/permissions allow|deny|ask` 的临时切换行为。
- 不做逐工具权限模拟执行。

## 行为

- `qingling permissions` 输出本地权限报告后退出。
- `qingling 权限` 与英文命令行为一致。
- 没有规则时输出 `(无规则)`。
- 配置中的非法 mode 由现有 config 解析层处理；报告层只做稳定展示。

## 验收

- 单测覆盖报告格式、无规则空态、规则展示、环境变量覆盖提示。
- CLI parser/help 覆盖 `permissions` 与 `权限`。
- smoke 覆盖顶层命令能读取环境变量 mode 并退出。
- `npm run build`、目标测试和 `npm run ci:check` 通过。
