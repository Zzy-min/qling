# `doctor` 本地可观测链路汇总规格（2026-06-01）

## 背景

轻灵已经有 `/doctor`、`/config`、`/mcp`、`/hooks` 等本地可观测入口，但 `doctor` 仍只覆盖基础运行环境，无法在一个入口里确认配置、MCP 和 hooks/guard 的关键状态。为了贴近 Claude Code 的“先诊断再执行”体验，需要把这些只读摘要接入 Doctor。

## 目标

- 扩展 `qling doctor` 与 `/doctor` 输出。
- 新增 Doctor checks：
  - `config`：provider、model、endpoint、api key 是否设置。
  - `mcp`：server 总数、启用数、connect/call timeout。
  - `hooks`：guard、permission default、rules、rate limit、content filter、custom pattern 数量。
- 所有新增字段只读取当前本地配置/环境。
- endpoint 必须脱敏 userinfo、query、hash。
- MCP URL、headers、env、hooks custom patterns、permission reason 不得出现在 Doctor 输出中。
- 不连接 MCP server，不运行 hooks，不读取 audit 内容，不联网，不调用模型，不写配置。

## 非目标

- 不替代 `/config`、`/mcp`、`/hooks` 的完整详细报告。
- 不执行 MCP 健康检查。
- 不执行 hooks 试运行。
- 不上传或落盘 Doctor 报告。

## 行为

- `config` 检查缺少 API key 时为 `warn`，否则为 `pass`。
- `mcp` 检查始终为 `pass`，因为无 server 是合法配置。
- `hooks` 检查 guard 开启为 `pass`，关闭为 `warn`。
- Doctor 仍只允许 daemon probe 访问本机 loopback。

## 验收

- 单测覆盖新增 `config`、`mcp`、`hooks` checks。
- 单测覆盖 endpoint/MCP/hook pattern/permission reason 脱敏。
- Smoke 覆盖 `qling doctor` 输出新 checks。
- `npm run build`、目标测试和 `npm run ci:check` 通过。
