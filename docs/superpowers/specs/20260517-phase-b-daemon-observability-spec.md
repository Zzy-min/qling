# `qling` 阶段 B：Daemon Observability for Goal/Tasks（2026-05-17）

## 背景

durable runner 已可用，但交互层仍有两个可观测缺口：

1. `/tasks` 主要基于本地 scheduler 视图，缺少显式 daemon 端控制通道。
2. `/goal daemon` 目前只支持创建，不支持显式查询与清理。

这会导致“后台已接管，但前台无法明确看见/干预”的体验断层。

## 目标

1. 增加 `/tasks daemon` 子语义：
   - `/tasks daemon`：列出 daemon runner tasks
   - `/tasks daemon cancel <id>`：取消 daemon task
   - `/tasks daemon clear`：清空 daemon tasks
2. 增加 `/goal daemon` 子语义：
   - `/goal daemon`：查询 daemon goal 状态
   - `/goal daemon clear`：清理 daemon goal
3. 命令输出明确标注来源与 runner，减少“这是本地视图还是后台视图”的歧义。

## 非目标

1. 本轮不新增 Dashboard 页面。
2. 本轮不新增 top-level `qling session` 子命令。
3. 本轮不改默认行为（local runner 仍是默认）。

## 方案

### A. DaemonSessionApi 扩展

新增方法：

1. `listLoopTasks(sessionId)`
2. `cancelLoopTask(sessionId, taskId)`
3. `clearLoopTasks(sessionId)`（循环 cancel）
4. `getGoal(sessionId)`

### B. `/tasks` 命令扩展

增加 `daemon` 子命令分支：

1. `/tasks daemon`
2. `/tasks daemon cancel <id>`
3. `/tasks daemon clear`

错误策略：

1. daemon API 不可用时返回明确错误，不静默 fallback。

### C. `/goal` 命令扩展

增加 `daemon` 下的管理分支：

1. `/goal daemon` -> status
2. `/goal daemon clear` -> clear
3. `/goal daemon <condition>` -> 保留现有创建路径

## 测试

1. unit:
   - `slash-commands.test.mjs` 覆盖新增命令路径
2. smoke:
   - 复用 durable smoke，保持 `/goal daemon` + `/tasks daemon` 所需 API 持续可用

## 验收

1. 用户在 TUI 可完整管理 daemon runner 的 goal/tasks，不需要切到文件系统手查。
2. `npm run ci:check` 全通过。
