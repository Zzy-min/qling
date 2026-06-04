# `qling` 阶段 B：Daemon Observability for Goal/Tasks 计划（2026-05-17）

## Step 1: 测试先行

- 修改 `tests/unit/slash-commands.test.mjs`
  - `/tasks daemon`
  - `/tasks daemon cancel <id>`
  - `/tasks daemon clear`
  - `/goal daemon`
  - `/goal daemon clear`

## Step 2: 扩展 daemon session api

- 修改 `src/session/daemon-session-api.ts`
  - list/cancel/clear loop tasks
  - get goal

## Step 3: 扩展 slash 命令

- 修改：
  - `src/commands/tasks.ts`
  - `src/commands/goal.ts`
  - `src/commands/help.ts`

## Step 4: 验证

- 运行：
  - `npm run build`
  - `node --test "tests/unit/slash-commands.test.mjs"`
  - `npm run ci:check`
