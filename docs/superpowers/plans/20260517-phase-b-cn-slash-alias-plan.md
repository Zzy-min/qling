# `qingling` 阶段 B：Slash 中文别名补齐计划（2026-05-17）

## Step 1: 测试先行

- 修改 `tests/unit/slash-commands.test.mjs`：
  - 新增 `/目标` 覆盖（映射 `/goal`）
  - 新增 `/任务` 覆盖（映射 `/tasks`）

## Step 2: 命令别名实现

- 修改：
  - `src/commands/goal.ts`
  - `src/commands/loop.ts`
  - `src/commands/tasks.ts`

## Step 3: 验证

- `npm run build`
- `node --test "tests/unit/slash-commands.test.mjs"`
- `npm run ci:check`
