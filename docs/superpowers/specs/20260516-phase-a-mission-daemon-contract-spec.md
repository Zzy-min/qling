# `qling` 阶段 A：Mission / Daemon / CLI 契约收敛设计（2026-05-16）

## 背景

当前 `qling` 已有 `mission`、`daemon` 和 Dashboard 雏形，但阶段 A 的主问题不是“没有能力”，而是“帮助文案、CLI、daemon API 和持久化状态不一致”：

1. `--help` 已声明 `mission logs <id>`，但 CLI 只真正支持 `mission start|list`。
2. `daemon` 只暴露 `GET /missions`、`POST /missions` 与 `/health`，缺少详情、日志和控制动作接口。
3. `MissionManager` 只写 mission 快照，不写事件日志，也没有 `pause`、`resume`、`cancel` 等生命周期方法。
4. 当前状态集合包含 `awaiting_approval`、`detached` 等旧语义，与新的阶段 A 计划不一致。

## 目标

1. 为 `mission` 建立最小但真实可用的生命周期主线。
2. 让 CLI 帮助文案、命令解析和实际执行能力一致。
3. 为 daemon 提供阶段 A 所需的只读详情、日志和控制动作接口。
4. 为后续 Dashboard、`/detach`、`agents` 视图保留稳定数据面。

## 非目标

1. 本轮不实现完整的 `agents` 视图。
2. 本轮不落地 `/goal`、`/loop`、权限模式和 worktree 隔离。
3. 本轮不重写 Dashboard 前端。
4. 本轮不解决插件运行时、Hook 扩展和通道回传。

## 用户旅程

1. 作为 CLI 用户，我可以启动一个 mission，并在后台守护进程存在或不存在时都得到一致的生命周期记录。
2. 作为 CLI 用户，我可以通过 `mission show` 和 `mission logs` 查看某个 mission 的状态与事件日志。
3. 作为 CLI 用户，我可以对未完成 mission 执行 `pause`、`resume`、`cancel`、`retry`。
4. 作为后续 Dashboard 调用方，我可以只通过 daemon 协议读取 mission 列表、详情和日志。

## 方案

### A. 生命周期收敛

- `MissionStatus` 收敛为：
  - `queued`
  - `running`
  - `blocked`
  - `paused`
  - `succeeded`
  - `failed`
  - `canceled`
- 去掉当前阶段未真正使用的 `detached` 和 `awaiting_approval` 对外语义。
- `retry` 行为定义为：基于原 mission 生成一个新的 queued mission，并在事件中记录来源。

### B. Mission 快照 + 事件日志

- 每个 mission 继续保留 `<id>.json` 快照文件。
- 新增 `<id>.events.jsonl` 事件流，采用 append-only 模式。
- 最小事件类型：
  - `state_changed`
  - `control`
  - `log`
- `createMission` 时写入初始 `queued` 事件。
- 每次状态迁移写入 `state_changed` 事件，包含 `from`、`to`、`error`、`reason`。

### C. MissionManager 能力补齐

- 新增方法：
  - `getMissionOrThrow(id)`
  - `getMissionLogs(id)`
  - `appendLog(id, message, meta?)`
  - `pauseMission(id, reason?)`
  - `resumeMission(id, reason?)`
  - `cancelMission(id, reason?)`
  - `retryMission(id)`
- 生命周期约束：
  - `pause` 仅允许从 `queued`、`running`、`blocked` 进入。
  - `resume` 仅允许从 `paused` 进入，并恢复到 `queued`。
  - `cancel` 不允许作用于终态 mission。
  - 终态定义为 `succeeded`、`failed`、`canceled`。

### D. Daemon API 扩展

- 保留：
  - `GET /missions`
  - `POST /missions`
  - `GET /health`
- 新增：
  - `GET /missions/:id`
  - `GET /missions/:id/logs`
  - `POST /missions/:id/pause`
  - `POST /missions/:id/resume`
  - `POST /missions/:id/cancel`
  - `POST /missions/:id/retry`
- 控制动作先只更新持久化状态和事件日志；本轮不做“真正暂停运行中的 AgentLoop 线程”。
- 必须诚实表达这一限制：阶段 A 提供的是控制契约与状态治理面，不是进程级抢占。

### E. CLI 命令收敛

- `mission` 子命令补齐：
  - `start`
  - `list`
  - `show`
  - `logs`
  - `pause`
  - `resume`
  - `cancel`
  - `retry`
- 当 daemon 在线时优先走 HTTP。
- 当 daemon 不在线时回退到本地 `MissionManager`。
- `--help` 文案同步更新，不再提前暴露尚未实现的命令。

## 测试策略

1. 单元测试覆盖 `MissionManager` 状态机与事件日志写入。
2. 单元测试覆盖 CLI 解析与帮助文案是否包含新的 `mission` 子命令。
3. Smoke 测试覆盖 daemon 在线时的 `mission show/logs/control` API 闭环。

## 验收

1. `npm run build` 通过。
2. 新增 `MissionManager` 单元测试通过。
3. CLI 相关单元与 smoke 测试通过。
4. `mission show`、`mission logs`、`pause`、`resume`、`cancel`、`retry` 实际可用。
