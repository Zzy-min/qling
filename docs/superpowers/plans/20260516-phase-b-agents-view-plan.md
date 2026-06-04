# `qling` 阶段 B：Agents 视图与后台任务管理体验计划（2026-05-16）

## Step 1: 测试先行

- 修改 `tests/unit/cli-startup.test.mjs`：
  - `agents` 解析为 `mode=agents`
  - `logs <id>` 解析为 `mode=logs`
  - `help` 文案包含 `agents`、`mission attach`、`mission stop`、`mission respawn`
- 新增 `tests/unit/mission-views.test.mjs`：
  - 按状态分组渲染 agents 视图
- 新增 `tests/smoke/agents-view.smoke.test.mjs`：
  - `qling agents` 展示 seeded mission
  - `qling logs <id>` 能读取 seeded 日志
- 新增 `tests/smoke/mission-attach.smoke.test.mjs`：
  - daemon 创建一个短任务
  - `mission attach <id>` 跟随日志直到终态并退出

## Step 2: 实现视图 helper

- 新增 `src/cli/mission-views.ts`：
  - agents 分组与渲染
  - 日志事件格式化
  - attach 跟随逻辑

## Step 3: CLI 接线

- 修改 `src/cli/startup-contract.ts`：
  - 新增 `agents`、`logs` 模式
  - 更新帮助文案
- 修改 `src/index.ts`：
  - 将管理类命令前移到 `AgentLoop` 初始化前
  - 增加 `agents` 与 `logs` 顶层路由
  - 为 `stop/respawn` 增加别名映射

## Step 4: 验证

- 运行：
  - `npm run build`
  - `node --test "tests/unit/mission-views.test.mjs"`
  - `node --test "tests/smoke/agents-view.smoke.test.mjs"`
  - `node --test "tests/smoke/mission-attach.smoke.test.mjs"`
- 通过后运行：
  - `npm run ci:check`
