# 本地记忆浏览实施计划

## User Journey
- 用户在 TUI 内输入 `/memory`，快速看到本地持久记忆和索引健康度。
- 用户输入 `/memory show mem_xxx`，审计某条本地记忆的来源和内容。
- 用户在任意终端执行 `qingling memory status`，不用启动 AgentLoop 也能检查本地 memory 状态。

## Implementation Steps
1. 新增 `src/memory-report.ts`，读取 `<stateDir>/memory/memory.json` 和 cognitive db 只读计数。
2. 新增 `src/commands/memory.ts`，实现 `/memory [count]`、`/memory show <id>`、中文别名。
3. 在 `src/commands/help.ts` 与 `src/commands/index.ts` 注册 slash 命令。
4. 在 `src/cli/startup-contract.ts` 增加中文顶层别名 `记忆`，并更新 help 文案。
5. 在 `src/index.ts` 的 AgentLoop 创建前处理 `memory status|list|show`；保留 `memory reindex` 原路径。
6. 新增/更新 unit 与 smoke 测试。
7. 运行目标测试和 `npm run ci:check`。

## Risk Controls
- 只读读取 memory 文件和 sqlite 表计数。
- show 仅按明确 ID 输出单条记忆，不做全文搜索。
- 不触碰 session 快照正文。
- 认知索引读取失败只产生 warning，不使 memory 浏览失败。

## Verification Commands
- `npm run build`
- `node --test "tests/unit/memory-report.test.mjs" "tests/unit/slash-commands.test.mjs" "tests/unit/cli-startup.test.mjs"`
- `node --test "tests/smoke/cli-startup.smoke.test.mjs"`
- `npm run ci:check`
