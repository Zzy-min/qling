# `qling` 交互体验：本地 `/mcp` 可视化规格（2026-06-01）

## 背景

顶层 `qling mcp` 已能在启动前查看本地 MCP 配置摘要，但用户进入交互会话后仍需要不中断会话地检查 MCP server 配置、timeout 与敏感字段脱敏状态。为了贴近 Claude Code 的 `/mcp` 可观测入口，需要把同一套只读报告接入 slash command。

## 目标

- 新增 slash command `/mcp`。
- 新增中文别名 `/外部工具`。
- 复用 `src/mcp-report.ts` 的本地 MCP 摘要格式。
- 输出 server 总数、启用数、timeout、每个 server 的 enabled/transport/command/args 或 url、env/header key。
- env/header 只显示 key 和 `set(redacted)`，不输出值。
- URL 去除 userinfo、query、hash，避免 token 泄露。
- 命令只读取当前进程本地配置环境，不连接 server、不启动子进程、不调用模型、不联网、不写配置。

## 非目标

- 不做 MCP server 健康检查。
- 不列出远端 tools。
- 不调用 MCP 连接逻辑。
- 不修改 MCP 配置。
- 不输出 env/header 的明文值。

## 行为

- `/mcp` 在当前会话输出本地 MCP 摘要，不改变会话状态。
- `/外部工具` 与 `/mcp` 行为一致。
- 无 MCP server 时输出 `(无 MCP server)`。
- 在交互会话中读取 `QLING_MCP_SERVERS`、`QLING_MCP_CONNECTION_TIMEOUT_MS`、`QLING_MCP_CALL_TIMEOUT_MS`，这些值由启动配置注入当前进程。

## 验收

- Slash command 单测覆盖 `/help` 展示 `/mcp` 与 `/外部工具`。
- Slash command 单测覆盖 `/mcp` 能读取 env 注入的 MCP server，输出脱敏 URL/header，且不泄露 secret。
- Slash command 单测覆盖 `/外部工具` 与英文命令行为一致。
- `npm run build`、目标测试和 `npm run ci:check` 通过。
