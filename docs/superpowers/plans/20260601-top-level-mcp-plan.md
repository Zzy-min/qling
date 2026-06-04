# `qingling mcp` 顶层本地 MCP 摘要计划（2026-06-01）

## Step 1: 测试先行

- 新增 `tests/unit/mcp-report.test.mjs`：
  - 空 server 输出稳定空态。
  - stdio server 输出 command/args、enabled、env key，且不输出 env 值。
  - http server 输出脱敏 URL、header key，且不输出 header 值。
  - timeout 与 enabled count 可读。
- 扩展 `tests/unit/cli-startup.test.mjs`：
  - `mcp` 顶层模式可解析。
  - `MCP` 与 `外部工具` 中文/本地别名可解析。
  - help 展示 `qingling mcp` 和别名。
- 扩展 `tests/smoke/cli-startup.smoke.test.mjs`：
  - `node dist/index.js MCP` 在 `QINGLING_MCP_SERVERS` env 下输出 MCP 摘要并退出。
  - stdout 不包含 env/header secret。

## Step 2: MCP 报告模块

- 新增 `src/mcp-report.ts`：
  - `buildLocalMcpReport(config.mcp)` 汇总本地 MCP 配置。
  - `formatLocalMcpReport(report)` 输出固定中文报告。
  - 对 URL、env、headers 做脱敏。

## Step 3: CLI 注册

- 在 `src/cli/startup-contract.ts` 新增 `mcp` 管理模式和 `MCP`、`外部工具` 顶层别名。
- 更新 help。
- 在 `src/index.ts` 的 AgentLoop 实例化之前处理 `decision.mode === "mcp"`。

## Step 4: 验证

- `npm run build`
- `node --test "tests/unit/mcp-report.test.mjs" "tests/unit/cli-startup.test.mjs" "tests/smoke/cli-startup.smoke.test.mjs"`
- `npm run ci:check`
