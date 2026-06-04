# `qling` 阶段 B：Daemon-backed Goal / Loop Durable Tasks 设计（2026-05-17）

## 背景

当前阶段 B 已经具备：

1. session-scoped `/loop`、`/tasks`、`/compact`
2. session-scoped `/goal`
3. `--continue` / `--resume` 会话恢复
4. `mission` / daemon 后台管理面

但 `/goal` 与 `/loop` 仍然只在前台交互进程内真正执行：

1. 终端关闭后不会继续推进
2. daemon 不会主动接管 session task / goal 状态文件
3. 如果直接让本地 scheduler 与 daemon 同时扫同一份 state，容易双触发

## 目标

1. 为 `/goal` 与 `/loop` 增加明确的 daemon-backed durable runner。
2. 关闭前台终端后，只要 `qlingd` 仍在运行，durable goal/loop 继续执行。
3. 复用现有 `session-goals` / `session-tasks` / `sessions` 快照体系，不另起一套完全独立的状态模型。
4. 保持当前 local session 模式兼容，避免直接破坏已经稳定的 `/goal`、`/loop` 本地体验。

## 非目标

1. 本轮不把所有 `/goal`、`/loop` 默认改成 daemon 模式。
2. 本轮不做 Dashboard 可视化控制面。
3. 本轮不做跨机器分布式调度。
4. 本轮不解决“同一 session 同时在多个前台 TUI 打开”的协同问题；先保证 local-vs-daemon 不双跑。

## 方案概览

### A. Runner 归属

对 session task / goal 引入 `runner` 字段：

- `session`
  - 由当前前台 TUI/REPL 执行
- `daemon`
  - 由 `qlingd` 执行

原则：

1. `SessionScheduler.runDueTasksOnce()` 只执行 `runner` 与当前实例一致的 task。
2. `SessionGoalController.afterTurn()` 只处理 `runner` 与当前实例一致的 active goal。
3. `listTasks()` / `getGoalStatus()` 允许查看所有 runner 的状态。

### B. Durable Loop

新增 daemon-backed loop 创建路径：

- `/loop daemon 5m 检查构建结果`

行为：

1. 先 checkpoint 当前 session。
2. 通过 daemon API 创建 `runner=daemon` 的 loop task。
3. daemon 内部 supervisor 定时扫描所有 `runner=daemon` 的 due task。
4. 执行时 restore 该 `sessionId` 对应快照，运行一个 turn，checkpoint 后退出本次 turn。

### C. Durable Goal

新增 daemon-backed goal 创建路径：

- `/goal daemon 所有测试通过`

行为：

1. 先 checkpoint 当前 session。
2. 通过 daemon API 创建 `runner=daemon` 的 active goal，并标记 `pending=true`。
3. daemon supervisor 发现该 pending goal 后接管执行。
4. daemon 内部使用 `SessionGoalController(runner=daemon)` 连续执行 turn，直到：
   - goal achieved
   - user clear/cancel
   - 达到 max auto turns

### D. 状态模型扩展

#### Session Task

新增字段：

- `runner: "session" | "daemon"`

默认：

- 旧任务无 `runner` 时按 `session` 兼容

#### Session Goal

新增字段：

- `runner: "session" | "daemon"`
- `pending: boolean`

默认：

- 旧 goal 无 `runner` 时按 `session` 兼容
- 无 `pending` 时按 `false` 兼容

### E. Daemon Supervisor

daemon 新增一个轻量 supervisor 循环：

1. 扫描 `session-goals/*.json`
2. 扫描 `session-tasks/*.json`
3. 用 `runningSessions` / `runningGoals` 之类内存锁避免同一 session 重入

调度顺序：

1. 若该 session 存在 `runner=daemon` 且 `pending=true` 的 active goal，优先执行 goal
2. 否则执行该 session 的 due daemon loop task

原因：

1. goal 是连续自治链路，应优先级高于 interval task
2. loop task 可在 goal 完成后继续

### F. Daemon API

新增：

1. `POST /sessions/:sessionId/loop-tasks`
2. `GET /sessions/:sessionId/loop-tasks`
3. `POST /sessions/:sessionId/loop-tasks/:taskId/cancel`
4. `POST /sessions/:sessionId/goal`
5. `GET /sessions/:sessionId/goal`
6. `POST /sessions/:sessionId/goal/clear`

这些 API 直接操作 session task / goal 状态文件，不通过 mission namespace 包一层伪 mission。

## 交互契约

### Slash

新增：

1. `/loop daemon <interval> <prompt>`
2. `/goal daemon <condition>`

兼容保留：

1. `/loop ...` 仍然是 local session runner
2. `/goal ...` 仍然是 local session runner

### `/tasks`

保持单入口，但输出要展示 `runner`，例如：

- `runner=session`
- `runner=daemon`

### `/goal`

查询状态时展示 `runner` 与 `pending`。

## 恢复语义

1. durable task / goal 的执行上下文来源仍是 `sessions/<sessionId>.json`
2. daemon 每次执行前 restore session
3. 每轮完成后 checkpoint session
4. 因此 durable loop / goal 与 `--continue` / `--resume` 可以自然接回同一 session identity

## 测试策略

1. 单元测试：
   - scheduler 对 runner 过滤执行
   - goal manager / controller 对 runner 过滤
   - slash `/loop daemon`、`/goal daemon`
2. Smoke 测试：
   - 启动真实 daemon
   - 创建 durable loop task，等待其触发并更新 session 快照
   - 创建 durable goal，等待其达成或进入 continue->achieved 链路

## 验收

1. `qling daemon start` 后，`/loop daemon ...` 在关闭 TUI 后仍能继续执行。
2. `qling daemon start` 后，`/goal daemon ...` 在关闭 TUI 后仍能继续执行直至达成/清除/超限。
3. local 与 daemon runner 不会双跑同一 task/goal。
4. `npm run build` 与 `npm run ci:check` 全通过。
