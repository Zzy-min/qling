# 顶层任务控制面实施计划

## User Journey
- 用户在任意终端执行 `qling tasks list`，看到本机持久化的 loop/daemon 任务状态。
- 用户发现后台任务不再需要，执行 `qling tasks cancel <taskId>`，不用重新附着 TUI 也能停止后续调度。
- 中文用户可执行 `qling 任务 列表` 与 `qling 任务 取消 <taskId>`。

## Implementation Steps
1. 新增 `src/session-task-report.ts`，读取 `<stateDir>/session-tasks/*.json` 并格式化本地任务报告。
2. 在 `src/cli/startup-contract.ts` 增加 `tasks` mode、管理命令集合和中文别名 `任务`。
3. 在 `src/index.ts` 的 AgentLoop 创建前处理 `tasks`，实现 `list` 与 `cancel`。
4. 更新 help 文案，保持英文主命令和中文别名一致。
5. 新增/更新单元测试：parser/help、本地任务报告、取消持久化、不读取 session 正文。
6. 新增 smoke 测试：顶层 list 和中文 cancel。
7. 运行 `npm run build`、目标测试、`npm run ci:check`。

## Risk Controls
- 只在显式 `cancel` 时写入本地 `session-tasks` 文件。
- 列表命令只读取任务元数据，不触碰 session 正文。
- 找不到任务返回明确错误，不做模糊删除或批量取消。
- 保持现有 `/tasks` slash 命令不变，避免影响正在运行的会话内调度器。

## Verification Commands
- `npm run build`
- `node --test "tests/unit/session-task-report.test.mjs" "tests/unit/cli-startup.test.mjs"`
- `node --test "tests/smoke/cli-startup.smoke.test.mjs"`
- `npm run ci:check`
