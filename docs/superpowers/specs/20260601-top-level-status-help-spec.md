# 顶层 `status/help` 本地基础交互规格（2026-06-01）

## 背景

轻灵已有会话内 `/status` 和 `--help`，但顶层 `qling status`、`qling help`、中文 `qling 状态`、`qling 帮助` 还会落入普通 one-shot 任务路径。这类基础查询如果误触发模型执行，会破坏 Claude Code 式 CLI 的可预期性，也不符合“数据留存本地、稳定优先”的交互目标。

## 目标

- 新增顶层命令 `qling status`。
- 新增中文顶层别名 `qling 状态`。
- 新增顶层帮助别名 `qling help` 与 `qling 帮助`。
- `status` 输出本地状态摘要：provider、model、endpoint、api key 状态、workspace、state dir、cache dir、git branch、本地 saved sessions 数量、本地 exports 数量、permission 默认模式、MCP enabled/total、hooks guard 状态。
- 只读取本地配置和文件元数据；不读取会话正文、不连接 MCP、不运行 hooks、不调用模型、不联网、不写配置。
- endpoint 必须脱敏 userinfo、query、hash；API key 只显示 `set(redacted)` 或 `missing`。

## 非目标

- 不替代 `/status` 的当前会话统计。
- 不替代 `doctor` 的诊断详情。
- 不展示 session/export 正文。
- 不执行 daemon probe。

## 行为

- `qling status` 输出状态摘要后退出。
- `qling 状态` 与英文命令一致。
- `qling help`、`qling 帮助` 与 `--help` 行为一致。
- 缺失 sessions/exports 目录时数量为 `0`，不报错。

## 验收

- 单测覆盖 status formatter、元数据计数、endpoint/API key 脱敏、不读取正文。
- CLI parser/help 覆盖 `status`、`状态`、`help`、`帮助`。
- Smoke 覆盖 `node dist/index.js status` 只读输出并退出，不泄露 secret。
- `npm run build`、目标测试和 `npm run ci:check` 通过。
