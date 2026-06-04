# `qingling mcp` 顶层本地 MCP 摘要规格（2026-06-01）

## 背景

轻灵已有 MCP client/registry/transport，但用户在执行任务前无法快速确认本地 MCP 配置了哪些 server、哪些启用、是否存在敏感环境变量或 headers。为了贴近 Claude Code 的可观测调试链路，需要一个不会连接外部服务的顶层只读入口。

## 目标

- 新增顶层命令 `qingling mcp`。
- 新增中文别名 `qingling MCP` 与 `qingling 外部工具`。
- 输出当前生效 MCP 配置摘要：server 总数、启用数、connection/call timeout。
- 对每个 server 输出：name、enabled、transport、command/args 或 url、env keys、header keys。
- env/header 只显示 key 和 `set(redacted)`，不输出值。
- URL 去除 userinfo、query、hash，避免 token 泄露。
- 命令只读取已加载配置，不连接 server、不启动子进程、不调用模型、不联网、不写配置。

## 非目标

- 不做 MCP 健康检查。
- 不列出远端 tools。
- 不调用 `MCPRegistry.connectAll()`。
- 不修改 MCP 配置。
- 不输出 env/header 的明文值。

## 行为

- `qingling mcp` 输出本地 MCP 摘要后退出。
- `qingling MCP`、`qingling 外部工具` 与英文命令行为一致。
- 无 MCP server 时输出 `(无 MCP server)`。
- stdio server 显示 command 和 args；http server 显示脱敏 url。

## 验收

- 单测覆盖无 server 空态、stdio/http server 展示、env/header 脱敏、URL 脱敏。
- CLI parser/help 覆盖 `mcp`、`MCP`、`外部工具`。
- smoke 覆盖顶层 `MCP` 可读取 env 注入的 server 并退出，且不泄露 token。
- `npm run build`、目标测试和 `npm run ci:check` 通过。
