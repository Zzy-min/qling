# `qling` 阶段 A：Daemon 控制命令设计（2026-05-16）

## 背景

当前 `qling` 已有 `dist/daemon.js` 可直接运行，但用户仍需要手动执行 `node dist/daemon.js`，这和阶段 A 计划中要求的 `qling daemon start|status|stop` 不一致。

现有缺口：

1. CLI 没有 `daemon` 命令族。
2. 没有 PID 文件与“是否已运行”的最小治理。
3. `detach` 失败提示仍要求用户手动运行 `qlingd` / `node dist/daemon.js`。
4. daemon 管理命令不应依赖 `AgentLoop` 或 API key，但当前 `index.ts` 会在大多数管理命令之前先实例化 agent。

## 目标

1. 增加 `qling daemon start|status|stop`。
2. 为 daemon 增加最小 PID 文件治理，默认落在 `runtime.file_state_dir` 下的 `daemon.pid`。
3. daemon 管理命令支持无 API key 使用。
4. `status` 能返回 daemon 是否在线、是否健康、是否受当前 CLI 管理。

## 非目标

1. 本轮不实现系统服务注册（Windows Service / launchd / systemd）。
2. 本轮不实现 daemon 自动重启与 watchdog。
3. 本轮不实现多实例或多端口管理。

## 方案

### A. CLI 命令面

- 在 `startup-contract` 中新增 `daemon` 模式。
- 帮助文案增加：
  - `qling daemon start`
  - `qling daemon status`
  - `qling daemon stop`

### B. 控制实现

- 新增 `src/cli/daemon-control.ts`：
  - `startDaemon()`
  - `getDaemonStatus()`
  - `stopDaemon()`
- `startDaemon()`：
  - 先检查 `daemon.pid` 是否存在。
  - 若 PID 存活且 `/health` 可达，则视为已运行，返回当前状态。
  - 若 PID 文件存在但进程不存在，则视为 stale，清理后重新启动。
  - 使用 detached child 方式启动 `dist/daemon.js`。
  - 轮询 `/health`，成功后写入 PID 文件。
- `getDaemonStatus()`：
  - 读取 PID 文件。
  - 探测进程是否存活。
  - 探测 `/health` 是否可达。
  - 输出 `running`、`healthy`、`managed`、`stalePidFile`、`pid`、`port`。
- `stopDaemon()`：
  - 使用 PID 文件定位子进程并发送终止信号。
  - 等待 `/health` 下线。
  - 清理 PID 文件。

### C. 无 API key 约束

- `index.ts` 中的 `daemon` 分支必须在 `AgentLoop` 实例化之前处理。
- `daemon start|status|stop` 不允许因为缺失 `OPENAI_API_KEY` / `DEEPSEEK_API_KEY` 而失败。

### D. 用户提示对齐

- `detach` 失败提示改为优先建议 `qling daemon start`。
- 帮助文案与实际能力同步更新。

## 测试策略

1. 单元测试：
  - CLI 解析支持 `daemon` 模式。
  - 帮助文案包含 daemon 子命令。
2. Smoke 测试：
  - `daemon start` 能拉起后台守护进程。
  - `daemon status` 返回 `running: true`。
  - `daemon stop` 能让 `/health` 下线并清理 PID 文件。

## 验收

1. `qling daemon start` 可重复调用，重复启动时不生成第二实例。
2. `qling daemon status` 在已启动、未启动、PID 残留三种场景下给出可信结果。
3. `qling daemon stop` 可停止由 CLI 启动的 daemon。
