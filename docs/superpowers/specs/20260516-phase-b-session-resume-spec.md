# `qingling` 阶段 B：Session Resume 与 `--continue` 设计（2026-05-16）

## 背景

阶段 B 已经具备：

1. session-scoped `/loop`、`/tasks`、`/compact`。
2. session-scoped `/goal` 自动续跑。
3. 旧式 `saveSession/loadSession/listSessions`，但只保存消息、轮数和 token 统计。

当前缺口是“恢复语义”没有闭环：

1. 没有 `--continue` / `--resume` 启动入口。
2. 没有稳定 checkpoint，TUI 每轮结束后不会自动保存当前 session。
3. 旧 session 文件不包含 `sessionId`，因此无法和 `session-goals/<sessionId>.json`、`session-tasks/<sessionId>.json` 对齐。
4. TUI 在恢复旧对话后也不会重建对应的 goal/task 控制器。

## 目标

1. 新增交互启动参数：
   - `qingling --continue`
   - `qingling --resume <session>`
   - `qingling chat --continue`
   - `qingling repl --resume <session>`
2. 让 TUI/REPL 每轮后自动写入当前 session checkpoint。
3. 恢复旧 session 时保留原始 `sessionId`，从而自动接回该 session 绑定的 `/goal` 与 `/loop` 状态文件。
4. 新增交互命令：
   - `/sessions`
   - `/resume [session|latest]`

## 非目标

1. 本轮不把 session 持久化提升为 daemon-backed durable task。
2. 本轮不实现跨机器同步。
3. 本轮不做 Claude Code 式完整会话树、分支或 supervisor UI。
4. 本轮不恢复 `memoryStore` 的内部临时 scratchpad；本轮恢复的核心是对话消息、session identity 与依附状态文件。

## 对标语义

参考 Claude Code 官方文档（2026-05-16 核对）：

1. `--continue` 是“恢复最近一次会话”。
2. `--resume <id>` 是“恢复指定会话”。
3. 被恢复的 session 应继续沿用原 session identity，而不是复制成新会话。
4. 交互模式下用户应能查看历史会话并切换进入。

## 方案

### A. Session Snapshot 结构

将 session 文件升级为包含身份与元数据的 snapshot：

- 路径：
  - `<runtime.file_state_dir>/sessions/<name>.json`
- 关键字段：
  - `version`
  - `name`
  - `sessionId`
  - `workspaceDir`
  - `createdAt`
  - `updatedAt`
  - `messages`
  - `turnCount`
  - `sessionTokens`
  - `compactionCount`

说明：

1. `name` 是当前快照名，可能是手工命名，也可能是自动 checkpoint 使用的 `sessionId`。
2. `sessionId` 是恢复 `/goal` 和 `/loop` 状态的主键，不允许在 restore 时重写。

### B. 自动 Checkpoint

新增一个“自动 checkpoint”能力：

1. TUI 每次成功完成一轮后自动写入 `sessions/<sessionId>.json`。
2. REPL 每次成功完成一轮后自动写入 `sessions/<sessionId>.json`。
3. `/clear`、`/compact`、`/resume` 这类会改变当前会话态的指令完成后，也要同步 checkpoint。

手工 `saveSession(name)` 继续保留，和自动 checkpoint 并存。

### C. 恢复链路

新增两个恢复入口：

1. `restoreLatestSession()`
   - 读取 `sessions/` 下 `updatedAt` 最新的 snapshot。
2. `restoreSession(nameOrSessionId)`
   - 允许通过文件基名、显式文件名或 snapshot 内的 `sessionId` 命中目标。

恢复后需要同步：

1. `messages`
2. `turnCount`
3. `sessionTokens`
4. `compactionCount`
5. `sessionId`
6. token budget 当前已使用量
7. pipeline session id

### D. TUI/REPL 接线

#### TUI

1. `StreamingREPL` 构造时接受 startup resume 选项。
2. `start()` 期间先恢复 session，再创建 scheduler 与 goal controller。
3. `/resume` 执行后，TUI 需要停止旧 scheduler，按新 `sessionId` 重建 scheduler 与 goal controller，再继续工作。

#### REPL

1. 支持同样的 startup `--continue` / `--resume` 语义。
2. 复用同一个 `AgentLoop` 恢复消息与 session identity。

### E. Slash 契约

新增：

1. `/sessions`
   - 列出最近保存的 session，至少显示 `name`、`sessionId`、`updatedAt`、`turnCount`
2. `/resume`
   - 无参数时恢复最近一次 session
3. `/resume <session>`
   - 恢复指定 session

### F. CLI 契约

新增全局选项：

1. `--continue`
2. `--resume <session>`

约束：

1. 只能用于 `chat` / `repl` 或默认交互模式。
2. 不能与 `run`、`mission`、`daemon`、`agents` 等非交互模式混用。
3. `--continue` 与 `--resume` 互斥。

## 测试策略

1. 单元测试：
   - session registry save/list/load/latest
   - CLI 对 `--continue` / `--resume` 的解析与冲突处理
   - `/sessions` 与 `/resume` 的 slash 行为
2. Smoke 测试：
   - 真正写入 checkpoint
   - restore 后保留原 `sessionId`
   - 同 sessionId 下重新加载到 loop/goal 侧文件

## 验收

1. `qingling --continue` 能恢复最近一次交互 session。
2. `qingling --resume <session>` 能恢复指定 session。
3. `/resume latest` 与 `/resume <id>` 可在 TUI 内切换 session。
4. 恢复后，原 session 的 `/goal` 与 `/loop` 状态文件会继续被命中。
5. `npm run build` 与 `npm run ci:check` 全通过。
