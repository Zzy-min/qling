# `qling privacy` 顶层本地隐私边界报告规格（2026-05-31）

## 背景

会话内 `/privacy` 已能说明本地数据留存路径和 provider 边界。但当用户只想在 shell 中确认“数据放在哪里、会不会被这个诊断命令上传、当前本地有多少会话快照”时，不应要求进入 TUI 或初始化模型。

## 目标

- 新增顶层命令 `qling privacy`。
- 复用现有 privacy report 输出风格，展示 workspace、state dir、sessions dir、cache dir、saved session count、模型配置。
- 在 `AgentLoop` 初始化前执行并退出，避免缺少 API key 或 provider 配置时阻断本地诊断。
- 只读取本地会话摘要数量，不输出消息正文、不联网、不调用模型。
- `qling --help` 展示 `qling privacy`。

## 非目标

- 不改变 `/privacy` slash command 行为。
- 不伪称全链路离线；仍要说明模型请求会按 provider 配置发送必要上下文。
- 不新增清理、删除、打开、上传、正文检索能力。
- 不修改 provider、权限模式、沙箱或网络策略。

## 行为

- `qling privacy` 输出“本地数据留存”并以 exit code 0 退出。
- 支持全局 `--file-state-dir`、`--file-cache-dir`、`--workspace`、`--model` 配置解析。
- 会话计数来自 `<stateDir>/sessions` 的本地会话注册表摘要。
- 会话文件损坏或目录缺失时沿用 `SessionRegistry.list()` 的容错行为，不把缺失目录视为失败。
- 与 `--continue` 或 `--resume` 组合时报模式冲突错误，保持管理命令一致性。

## 验收

- 单测覆盖本地 privacy builder 可统计临时 state dir 中的会话数量。
- 单测覆盖 CLI parser 识别 `privacy`。
- 单测覆盖帮助文案包含 `qling privacy`。
- smoke 覆盖 `qling privacy` 可直接退出、输出本地留存报告、且不输出会话正文。
- `npm run build`、相关测试和 `npm run ci:check` 通过。
