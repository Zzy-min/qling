# `qingling config` 顶层本地配置摘要规格（2026-06-01）

## 背景

轻灵已有会话内 `/config`，但用户在进入 TUI 或执行任务前，仍缺少一个不会启动 AgentLoop 的顶层配置可见性入口。为了提升 Claude Code 风格的可预期性，需要能快速确认模型、路径、权限和本地留存目录，同时保证密钥不会被打印。

## 目标

- 新增顶层命令 `qingling config`。
- 新增中文别名 `qingling 配置`。
- 输出当前生效配置摘要：provider、model、endpoint、workspace、state dir、cache dir、permissions、features、logging、agents isolation。
- API key 只显示 `set(redacted)` 或 `missing`，不得输出原值或尾号。
- endpoint 输出时去掉 userinfo、query、hash，避免误泄露 URL 中的 token。
- 命令只读取已加载配置和当前进程环境，不写配置、不启动 AgentLoop、不调用模型、不联网。

## 非目标

- 不编辑配置文件。
- 不展示完整 raw config。
- 不输出任何 secret、token、password、api key 明文。
- 不改变会话内 `/config` 行为。

## 行为

- `qingling config` 输出摘要后退出。
- `qingling 配置` 与英文命令行为一致。
- 如果没有 api key，输出 `Api key : missing`。
- 如果存在 api key，输出 `Api key : set(redacted)`。
- 如果 endpoint 非 URL 字符串，仍展示脱敏后的字符串，并对 `key/token/secret/password` 查询片段做兜底替换。

## 验收

- 单测覆盖密钥脱敏、endpoint 脱敏、主要字段输出、feature flags 输出。
- CLI parser/help 覆盖 `config` 与 `配置`。
- smoke 覆盖顶层 `配置` 能使用 env model/api key 输出摘要并退出，且不泄露 api key。
- `npm run build`、目标测试和 `npm run ci:check` 通过。
