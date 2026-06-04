# `qingling` 阶段 B：Session Goal 与自动续跑计划（2026-05-16）

## Step 1: 测试先行

- 新增 `tests/unit/session-goal-manager.test.mjs`
  - set goal
  - clear goal
  - mark achieved
  - status snapshot
- 新增 `tests/unit/goal-controller.test.mjs`
  - evaluator=false 时返回 continuation prompt
  - evaluator=true 时停止
  - 超过 max auto turns 时自动 clear
- 修改 `tests/unit/slash-commands.test.mjs`
  - `/goal` 出现在 help
  - `/goal <condition>` 调用 controller 并设置 immediate prompt
  - `/goal clear` 调用 controller
- 新增 `tests/smoke/session-goal.smoke.test.mjs`
  - 真正落盘 goal 状态
  - mock evaluator 下完成一轮未达成、一轮达成

## Step 2: 实现 goal 模块

- 新增：
  - `src/session/session-goal-manager.ts`
  - `src/session/goal-evaluator.ts`
  - `src/session/goal-controller.ts`

## Step 3: 扩展 slash runtime

- 修改：
  - `src/commands/runtime.ts`
  - `src/commands/types.ts`
  - `src/commands/index.ts`
  - `src/commands/help.ts`
- 新增：
  - `src/commands/goal.ts`

## Step 4: REPL 接线

- 修改 `src/tui/streaming-repl.ts`
  - 初始化 goal controller
  - `/goal` 设定后立即开 turn
  - 每个 turn 后执行 goal evaluation
  - 未达成时自动继续下一 turn
  - goal 链路运行期间保持 scheduler busy
- 必要时扩展 `src/agent-loop.ts`
  - 暴露 transcript/message snapshot

## Step 5: 验证

- 运行：
  - `npm run build`
  - `node --test "tests/unit/session-goal-manager.test.mjs"`
  - `node --test "tests/unit/goal-controller.test.mjs"`
  - `node --test "tests/unit/slash-commands.test.mjs"`
  - `node --test "tests/smoke/session-goal.smoke.test.mjs"`
- 全通过后运行：
  - `npm run ci:check`
