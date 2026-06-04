# `qling` 阶段 A：Mission / Daemon / CLI 契约收敛实施计划（2026-05-16）

## Step 1: 测试先行

- 新增 `tests/unit/mission-manager.test.mjs`：
  - 创建 mission 写入初始快照和 `queued` 事件。
  - `pause/resume/cancel/retry` 的状态迁移符合约束。
  - `appendLog` 会写入 JSONL 并可被 `getMissionLogs` 读取。
- 修改 `tests/unit/cli-startup.test.mjs`：
  - `mission` 子命令解析仍走 `mission` 模式。
  - `--help` 文案包含 `show/logs/pause/resume/cancel/retry`。
- 新增 `tests/smoke/mission-cli.smoke.test.mjs`：
  - 启动 `dist/daemon.js`。
  - 用 CLI 或 HTTP 调用创建 mission、查看详情、读取日志、执行控制动作。

## Step 2: MissionManager 实现

- 修改 `src/mission/types.ts`：
  - 收敛 `MissionStatus`。
  - 增强 `MissionEvent` 类型定义。
- 修改 `src/mission/manager.ts`：
  - 加入事件日志路径与 append-only 写入。
  - 增加 `getMissionOrThrow`、`getMissionLogs`、`appendLog`、`pauseMission`、`resumeMission`、`cancelMission`、`retryMission`。
  - 对非法状态转换抛出结构化错误。

## Step 3: Daemon API 实现

- 修改 `src/daemon.ts`：
  - 增加 mission 详情、日志和控制动作路由。
  - 在后台执行前后记录日志事件。
  - `retry` 生成新 mission，并在响应中返回新的 mission id。

## Step 4: CLI `mission` 子命令实现

- 修改 `src/index.ts`：
  - 在 daemon 在线时调用新增 HTTP 接口。
  - daemon 不在线时回退到本地 `MissionManager`。
  - 输出统一的任务详情、日志和控制结果。
- 修改 `src/cli/startup-contract.ts`：
  - 更新帮助文案，显式展示阶段 A 子命令。

## Step 5: 验证

- 运行：
  - `npm run build`
  - `node --test "tests/unit/mission-manager.test.mjs"`
  - `node --test "tests/unit/cli-startup.test.mjs"`
  - `node --test "tests/smoke/mission-cli.smoke.test.mjs"`
- 若阶段 A 新增测试稳定，再跑：
  - `npm run ci:check`
