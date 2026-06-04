# `qingling` 阶段 B：Agents 视图与后台任务管理体验设计（2026-05-16）

## 背景

阶段 A 已经补齐 `mission` 生命周期、daemon API 和 `daemon start|status|stop`，但后台任务的用户体验仍停留在“知道有 mission 文件”，还没有形成稳定的管理心智。

当前缺口：

1. 没有 `qingling agents` 总览入口。
2. `mission logs` 只能一次性打印，不支持“跟随当前任务直到结束”的 attach 体验。
3. `cancel/retry` 已有实现，但缺少 `stop/respawn` 这种更贴近后台任务心智的别名。
4. `mission list/show/logs/...` 等纯管理命令仍依赖 `AgentLoop` 初始化，缺 API key 时体验不合理。

## 目标

1. 新增 `qingling agents`，按任务状态分组展示后台任务。
2. 新增 `qingling mission attach <id>`，以轮询方式跟随 mission 日志直到终态或用户中断。
3. 新增易懂别名：
  - `mission stop <id>` -> `mission cancel <id>`
  - `mission respawn <id>` -> `mission retry <id>`
  - `qingling logs <id>` -> `mission logs <id>`
4. 让纯管理命令在无 API key 场景下仍可用。

## 非目标

1. 本轮不实现真正的交互式 attach 到运行中 `AgentLoop`。
2. 本轮不实现 Dashboard 的实时推流。
3. 本轮不实现 `goal/loop` 调度器。

## 方案

### A. 命令面

- 新增顶层命令：
  - `qingling agents`
  - `qingling logs <id>`
- 扩展 `mission` 子命令：
  - `attach <id>`
  - `stop <id>`（`cancel` 别名）
  - `respawn <id>`（`retry` 别名）

### B. Agents 视图

- 任务按 3 个 bucket 展示：
  - `Working`: `queued`、`running`
  - `Needs Input`: `blocked`、`paused`
  - `Completed`: `succeeded`、`failed`、`canceled`
- 每条记录展示：
  - `id`
  - `status`
  - `name`
  - `createdAt`
  - `description` 摘要

### C. Attach 语义

- `mission attach <id>` 是只读跟随，不是进程内交互接管。
- 实现方式：
  - 周期性获取 mission 详情和日志。
  - 只打印新增事件。
  - mission 到达终态后自动退出。
  - 用户 `Ctrl+C` 可中断跟随。
- 输出必须明确说明是“只读跟随”，避免误导为全交互 attach。

### D. 管理命令前移

- 纯管理命令在 `index.ts` 中前移到 `AgentLoop` 初始化前处理：
  - `mission list`
  - `mission show`
  - `mission logs`
  - `mission attach`
  - `mission pause`
  - `mission resume`
  - `mission cancel`
  - `mission stop`
  - `mission retry`
  - `mission respawn`
  - `agents`
  - `logs`
- 需要本地回退时直接实例化 `MissionManager`，不走 `AgentLoop`。

## 测试策略

1. 单元测试：
  - CLI 解析支持 `agents` 与 `logs`。
  - `help` 文案包含 `agents`、`attach`、`stop`、`respawn`。
  - agents 视图渲染按 bucket 正确分组。
2. Smoke 测试：
  - `qingling agents` 可展示 seeded mission。
  - `mission attach` 在 daemon 在线时能跟随到成功日志并自动退出。

## 验收

1. 无 API key 时，`qingling agents` / `mission list|show|logs|attach` 仍可用。
2. `mission attach` 能在任务结束时自动退出。
3. `stop/respawn` 与 `cancel/retry` 行为一致。
