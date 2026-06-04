# `qling` 阶段 A：Daemon 控制命令实施计划（2026-05-16）

## Step 1: 测试先行

- 修改 `tests/unit/cli-startup.test.mjs`：
  - `daemon status` 解析为 `mode=daemon`。
  - `--help` 包含 `daemon start|status|stop`。
- 新增 `tests/smoke/daemon-control.smoke.test.mjs`：
  - 用临时 `QLING_FILE_STATE_DIR` 和临时 `QLING_DAEMON_PORT` 运行 `daemon start`。
  - 验证 `/health` 可达。
  - 调用 `daemon status`，校验 `running`、`healthy`、`managed`。
  - 调用 `daemon stop`，校验 `/health` 下线与 PID 文件移除。

## Step 2: 控制层实现

- 新增 `src/cli/daemon-control.ts`：
  - PID 文件读写
  - 健康探测
  - detached child 启停
  - stale PID 清理

## Step 3: CLI 接线

- 修改 `src/cli/startup-contract.ts`：
  - 新增 `daemon` 模式。
  - 更新帮助文案。
- 修改 `src/index.ts`：
  - 在 `AgentLoop` 初始化前处理 `daemon start|status|stop`。

## Step 4: 用户提示修正

- 修改 `src/commands/detach.ts`：
  - 守护进程未运行时，引导用户执行 `qling daemon start`。

## Step 5: 验证

- 运行：
  - `npm run build`
  - `node --test "tests/unit/cli-startup.test.mjs"`
  - `node --test "tests/smoke/daemon-control.smoke.test.mjs"`
- 若通过，再运行：
  - `npm run ci:check`
