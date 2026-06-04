# `qingling` 交互体验：本地 `/mcp` 可视化实施计划（2026-06-01）

## Step 1: 测试先行

- 扩展 `tests/unit/slash-commands.test.mjs`：
  - `/help` 包含 `/mcp` 与 `/外部工具`。
  - `/mcp` 从 `QINGLING_MCP_SERVERS` 输出本地 MCP 摘要。
  - `/mcp` 不输出 URL userinfo/query/header secret。
  - `/外部工具` 中文别名可用。

## Step 2: Slash command 接入

- 新增 `src/commands/mcp.ts`。
- 在命令中从当前进程环境构造最小 MCP config，并调用 `buildLocalMcpReport`。
- 注册到 `src/commands/index.ts`。
- 更新 `src/commands/help.ts`。

## Step 3: 验证

- `npm run build`
- `node --test "tests/unit/mcp-report.test.mjs" "tests/unit/slash-commands.test.mjs"`
- `npm run ci:check`
