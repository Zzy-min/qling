# 本地记忆搜索实施计划

## User Journey
- 用户在 TUI 内输入 `/memory search qling 5`，快速看到本地持久记忆中与 qling 相关的条目。
- 用户看到每条结果的 `matched via` 标签，知道命中来自 content、source 还是 id。
- 用户在任意终端执行 `qling memory search "权限模式"`，无需启动 AgentLoop 即可本地检索记忆。

## Implementation Steps
1. 扩展 `src/memory-report.ts`：
   - 增加 `searchLocalMemoryEntries(stateDir, request)`。
   - 增加 `parseMemorySearchArgs(args)`。
   - 增加 `formatLocalMemorySearchReport(report)`。
2. 扩展 `src/commands/memory.ts`：
   - 支持 `/memory search <query> [count]`。
   - 支持中文 `/记忆 搜索 <query> [count]`。
3. 扩展 `src/index.ts` 顶层 memory 分支：
   - 在 AgentLoop 创建前处理 `memory search`。
   - 保持 `memory reindex` 原路径不变。
4. 更新 help：
   - slash help 展示 `/memory search`。
   - `qling --help` 展示 `memory search`。
5. 写 RED 测试：
   - memory report 单元测试。
   - slash command 测试。
   - parser/help 测试。
   - CLI startup smoke。
6. 实现代码后运行目标测试，再运行 `npm run ci:check`。

## Risk Controls
- 搜索函数只读 `memory.json`，不读取 session 目录。
- 搜索结果只展示 preview，避免误把 search 变成全文导出。
- 无 query 走错误提示，不执行全量 dump。
- 对 count 做与 `/memory` 一致的默认与上限保护。

## Verification Commands
- `npm run build`
- `node --test "tests/unit/memory-report.test.mjs" "tests/unit/slash-commands.test.mjs" "tests/unit/cli-startup.test.mjs"`
- `node --test "tests/smoke/cli-startup.smoke.test.mjs"`
- `npm run ci:check`
