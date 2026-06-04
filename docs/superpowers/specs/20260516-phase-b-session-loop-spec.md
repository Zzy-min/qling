# `qling` 阶段 B：Session Loop 与 Slash 命令一致性设计（2026-05-16）

## 背景

阶段 B 现在已经有 `agents`、`attach`、`logs` 等后台管理入口，但交互态仍缺一块关键能力：让当前 session 在“空闲时继续做事”。

现状缺口：

1. `/help` 提到了 `/compact`，但命令并未注册。
2. 没有 `/loop`，无法在当前 session 内轮询任务或持续维护当前工作。
3. 没有 `/tasks`，用户无法查看或取消当前 session 的计划任务。
4. 当前 slash 命令只能拿到 `AgentLoop`，无法访问调度器或额外运行态服务。

## 目标

1. 新增 session-scoped 的 `/loop`，支持在当前会话空闲时周期性重跑 prompt。
2. 新增 `/tasks`，用于查看和取消当前 session 的 loop 任务。
3. 补上真实可用的 `/compact`，让帮助文案与实际能力一致。
4. 保持任务只在“会话仍存活且空闲”时触发，不引入 daemon 级长期调度复杂度。

## 非目标

1. 本轮不实现 `/goal`。它需要独立 evaluator 与跨回合自治闭环，风险面高于本轮目标。
2. 本轮不实现跨新会话恢复 `/loop` 任务。
3. 本轮不实现 cron 表达式、Desktop/Cloud 级持久任务。
4. 本轮不实现 `Esc` 级热键控制，取消通过命令完成。

## 方案

### A. Slash 命令上下文收敛

- 将 slash 命令执行签名从单一 `AgentLoop` 升级为 `SlashCommandContext`：
  - `agentLoop`
  - `scheduler`
  - `writeLine()` / `writeError()` 输出面
- 保持现有命令代码迁移成本最低，旧命令只需把 `agentLoop` 读取改为 `context.agentLoop`。

### B. Session 调度器

- 新增一个轻量 session 调度器，职责只有：
  - 管理当前 session 的 loop 任务
  - 在 REPL 空闲时触发 prompt
  - 在忙碌时记录 pending，待空闲后补触发一次
- 状态文件落盘到：
  - `<runtime.file_state_dir>/session-tasks/<sessionId>.json`
- 任务模型至少包含：
  - `id`
  - `kind=loop`
  - `prompt`
  - `intervalMs`
  - `mode=fixed|default`
  - `status=active|running|completed|canceled`
  - `createdAt`
  - `updatedAt`
  - `lastRunAt`
  - `nextRunAt`
  - `pending`

### C. `/loop` 契约

- 支持：
  - `/loop 5m 检查构建结果`
  - `/loop 检查构建结果`
  - `/loop`
- 行为：
  - 同时给 interval 与 prompt：按固定间隔执行 prompt
  - 只给 prompt：本轮实现降级为固定 `10m`
  - 只给 interval 或不给参数：使用项目 `.claude/loop.md`，其次 `~/.claude/loop.md`，都不存在则使用内置 maintenance prompt
- 内置 maintenance prompt 只允许：
  - 继续当前对话已授权的未完成工作
  - 检查当前分支/工作区是否有未完成验证
  - 没有待办时只输出一行空闲结论
- 停止方式：
  - `/tasks cancel <id>`
  - `/loop stop <id>` 作为便捷别名

### D. `/tasks` 契约

- 默认列出当前 session 的计划任务：
  - `id`
  - `status`
  - `mode`
  - `nextRunAt`
  - `prompt` 摘要
- 支持：
  - `/tasks`
  - `/tasks cancel <id>`
  - `/tasks clear`（取消所有 active/running/pending loop）

### E. `/compact` 契约

- 手动触发一次当前对话压缩：
  - 运行 `ContextCompactor` 压缩消息
  - 更新 `compactionCount`
  - 触发持久记忆的 compact
- 输出至少包含：
  - 压缩前消息数
  - 压缩后消息数
  - 本次是否实际发生压缩

### F. 触发与并发策略

- 任务只在 REPL 空闲时运行。
- 如果计划时间到达时 REPL 正忙：
  - 不做 catch-up
  - 仅记一个 `pending=true`
  - 当前回合结束后立即执行一次
- 调度器不直接操作 `AgentLoop` 内部状态，只通过 REPL 的统一执行路径发起 prompt。

## 测试策略

1. 单元测试：
  - `/help` 显示 `/loop`、`/tasks`、`/compact`
  - scheduler 能创建、列出、取消任务
  - scheduler 在 busy 时只标记 pending，不重复补跑
  - `loop.md` 解析优先级正确
2. Smoke 测试：
  - `/loop 1m <prompt>` 可创建任务并落盘
  - `/tasks` 能看到新任务
  - `/tasks cancel <id>` 可取消任务

## 验收

1. `/help` 与实际可用命令一致。
2. `/loop` 创建的任务能在当前 session 空闲时触发。
3. `busy` 场景不会重复补跑历史 tick。
4. `/tasks` 能查看并取消任务。
5. `/compact` 真实调用上下文压缩而不是占位输出。
