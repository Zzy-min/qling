# 顶层目标控制面实施计划

## User Journey
- 用户执行 `qling goal status`，快速看到本机所有持久化目标的状态，不需要重新进入 TUI。
- 用户执行 `qling goal set "完成 ci:check"`，把最近会话交给 daemon goal 状态机后续推进。
- 用户执行 `qling goal clear latest` 或 `qling 目标 清除`，停止最近会话的本地 goal。

## Implementation Steps
1. 新增 `src/session-goal-report.ts`，提供本地 goal 列表、latest session 解析、set、clear、格式化输出。
2. 在 `src/cli/startup-contract.ts` 增加 `goal` mode 和中文别名 `目标`。
3. 在 `src/index.ts` 的 AgentLoop 创建前处理 `goal status|set|clear`。
4. 更新 help 文案，保持英文主命令和中文别名一致。
5. 新增单元测试覆盖本地 goal 报告与 mutation 行为，并证明不读取 session 正文。
6. 更新 cli parser 单测和 startup smoke 测试。
7. 运行目标测试与 `npm run ci:check`。

## Risk Controls
- `status` 只读 `session-goals`。
- `set`/`clear` 只修改单个 session 的 goal 文件。
- 默认目标 session 必须来自 `SessionRegistry.loadLatest()`，避免无会话时产生孤儿状态。
- 输出只包含 goal/session 摘要字段，不输出 messages。

## Verification Commands
- `npm run build`
- `node --test "tests/unit/session-goal-report.test.mjs" "tests/unit/cli-startup.test.mjs"`
- `node --test "tests/smoke/cli-startup.smoke.test.mjs"`
- `npm run ci:check`
