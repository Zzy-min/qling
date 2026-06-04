# `qingling` 阶段 B：Daemon-backed Goal / Loop Durable Tasks 计划（2026-05-17）

## Step 1: 测试先行

- 修改 `tests/unit/session-scheduler.test.mjs`
  - task 带 `runner`
  - local scheduler 不执行 `runner=daemon`
  - daemon scheduler 不执行 `runner=session`
- 修改 `tests/unit/session-goal-manager.test.mjs`
  - goal 带 `runner` / `pending`
  - 查询兼容旧字段
- 修改 `tests/unit/goal-controller.test.mjs`
  - local controller 忽略 `runner=daemon`
  - daemon controller 忽略 `runner=session`
- 修改 `tests/unit/slash-commands.test.mjs`
  - `/loop daemon ...`
  - `/goal daemon ...`
- 新增 `tests/smoke/durable-session-tasks.smoke.test.mjs`
  - 启动真实 daemon
  - 创建 durable loop task
  - 创建 durable goal
  - 验证 session snapshot 被后台推进

## Step 2: 扩展状态模型

- 修改：
  - `src/session/session-scheduler.ts`
  - `src/session/session-goal-manager.ts`
  - `src/session/goal-controller.ts`

## Step 3: 实现 daemon supervisor

- 新增：
  - `src/session/durable-session-supervisor.ts`
- 修改：
  - `src/daemon.ts`

目标：

1. 周期扫描 `runner=daemon` goal/task
2. restore session
3. 执行 turn
4. checkpoint session

## Step 4: 新增 daemon session API

- 修改：
  - `src/daemon.ts`

API：

1. `POST /sessions/:sessionId/loop-tasks`
2. `GET /sessions/:sessionId/loop-tasks`
3. `POST /sessions/:sessionId/loop-tasks/:taskId/cancel`
4. `POST /sessions/:sessionId/goal`
5. `GET /sessions/:sessionId/goal`
6. `POST /sessions/:sessionId/goal/clear`

## Step 5: 接线到 slash commands

- 修改：
  - `src/commands/loop.ts`
  - `src/commands/goal.ts`
  - `src/commands/tasks.ts`
  - `src/commands/help.ts`
  - `src/commands/runtime.ts`（如需传 daemon endpoint / helpers）

## Step 6: 验证

- 运行：
  - `npm run build`
  - `node --test "tests/unit/session-scheduler.test.mjs"`
  - `node --test "tests/unit/session-goal-manager.test.mjs"`
  - `node --test "tests/unit/goal-controller.test.mjs"`
  - `node --test "tests/unit/slash-commands.test.mjs"`
  - `node --test "tests/smoke/durable-session-tasks.smoke.test.mjs"`
- 全通过后运行：
  - `npm run ci:check`
