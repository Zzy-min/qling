# `qingling` 阶段 B：`agents.isolation.*` 契约收敛规格（2026-05-17）

## 背景

- 重做计划已明确新增 `agents.isolation.*` 配置契约。
- 当前代码尚未提供该配置实体，也缺少统一的 Git/非 Git 隔离判定入口。

## 目标

1. 在配置层新增 `agents.isolation.*` 并支持环境变量映射。
2. 提供统一隔离策略评估器（Git 仓库优先 worktree，非 Git 可警告或拒绝）。
3. 在 `/loop daemon` 入口接入前置检查，给出可观测的降级提示。

## 配置契约

- `agents.isolation.mode`: `worktree | off`
- `agents.isolation.require_git`: `boolean`
- `agents.isolation.non_git_policy`: `warn | deny | off`

默认值：
- `mode=worktree`
- `require_git=true`
- `non_git_policy=warn`

## 运行语义

- Git 仓库 + `mode=worktree`：通过，标记可使用 worktree 隔离。
- 非 Git 仓库：
  - `non_git_policy=warn`：允许继续，但输出安全降级提示。
  - `non_git_policy=deny`：阻止高并行后台入口（本轮先作用于 `/loop daemon`）。
  - `non_git_policy=off`：静默继续。

## 非目标

- 本轮不实现真实 worktree 自动创建与生命周期回收。
- 本轮不改 mission 执行器内部调度拓扑。

## 验收

- `config` 可加载/导出 `agents.isolation.*`。
- 隔离策略评估器有独立单测覆盖 Git / 非 Git + warn/deny 分支。
- `/loop daemon` 在非 Git + deny 下拒绝，并在 warn 下给出提示。
