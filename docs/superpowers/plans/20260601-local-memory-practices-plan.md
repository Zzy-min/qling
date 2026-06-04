# 本地蒸馏实践浏览实施计划

## User Journey
- 用户在 TUI 内输入 `/memory practices`，快速查看本地经验蒸馏结果。
- 用户输入 `/记忆 经验 5`，看到高置信度实践及其动作/文件预览。
- 用户在任意终端执行 `qingling memory practices`，无需启动 AgentLoop 即可审计本地实践索引。

## Implementation Steps
1. 扩展 `src/memory-report.ts`：
   - 增加 `listLocalMemoryPractices(stateDir, options)`。
   - 增加 `formatLocalMemoryPracticesReport(report)`。
   - 复用 count 规则：默认 10、最大 50。
2. 扩展 `src/commands/memory.ts`：
   - 支持 `/memory practices [count]`、`/memory practice [count]`。
   - 支持中文 `/记忆 实践 [count]`、`/记忆 经验 [count]`。
3. 扩展 `src/index.ts`：
   - 在 AgentLoop 创建前处理 `memory practices|practice`。
   - 保持 `memory reindex` 原行为。
4. 更新 help：
   - slash help 展示 `/memory practices`。
   - `qingling --help` 展示 `memory practices`。
5. 写 RED 测试：
   - memory-report 单元测试覆盖 DB/table 缺失、排序、count、JSON 降级。
   - slash command 测试覆盖英文/中文。
   - parser/help 与 CLI startup smoke 覆盖顶层命令。
6. 运行目标测试，再运行完整 `npm run ci:check`。

## Risk Controls
- SQLite 只读打开，失败时降级为 empty + warning。
- 只读取 `distilled_practices` 表，不读取 embeddings BLOB 或 session 文件。
- JSON 字段只做摘要预览，避免把实践浏览变成全文导出。
- 不新增任何删除、写入、上传、检索外部文档行为。

## Verification Commands
- `npm run build`
- `node --test "tests/unit/memory-report.test.mjs" "tests/unit/slash-commands.test.mjs" "tests/unit/cli-startup.test.mjs"`
- `node --test "tests/smoke/cli-startup.smoke.test.mjs"`
- `npm run ci:check`
