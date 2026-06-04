# `qling` 阶段 B：Session Loop 与 Slash 命令一致性计划（2026-05-16）

## Step 1: 测试先行

- 修改 `tests/unit/command-help.test.mjs` 或新增等价单测：
  - `/help` 文案包含 `/loop`、`/tasks`、`/compact`
- 新增 `tests/unit/session-scheduler.test.mjs`：
  - 创建 loop 任务
  - 列表渲染
  - busy 时仅标记 pending
  - 取消任务
- 新增 `tests/unit/loop-prompt.test.mjs`：
  - `.claude/loop.md` 优先于 `~/.claude/loop.md`
  - 缺省时回退到内置 maintenance prompt
- 新增 `tests/smoke/session-loop.smoke.test.mjs`：
  - 在临时 `QLING_FILE_STATE_DIR` 下创建 loop
  - 校验 `/tasks` 能列出
  - 校验 `/tasks cancel` 生效

## Step 2: 实现调度与命令上下文

- 新增 `src/commands/runtime.ts`：
  - `SlashCommandContext`
- 新增 `src/session/session-scheduler.ts`：
  - 任务持久化
  - 创建/列出/取消
  - busy/pending 协议
- 新增 `src/session/loop-prompt.ts`：
  - 解析 `.claude/loop.md`
  - 生成内置 maintenance prompt

## Step 3: 实现 slash 命令

- 修改 `src/commands/types.ts`
- 修改 `src/commands/index.ts`
- 新增：
  - `src/commands/loop.ts`
  - `src/commands/tasks.ts`
  - `src/commands/compact.ts`
- 修改 `src/commands/help.ts`：
  - 补齐真实命令集合

## Step 4: REPL 接线

- 修改 `src/tui/streaming-repl.ts`：
  - 持有 scheduler
  - 忙碌状态切换
  - 空闲后执行 pending loop prompt
- 必要时扩展 `src/agent-loop.ts`：
  - 暴露手动 compact API

## Step 5: 验证

- 运行：
  - `npm run build`
  - `node --test "tests/unit/session-scheduler.test.mjs"`
  - `node --test "tests/unit/loop-prompt.test.mjs"`
  - `node --test "tests/smoke/session-loop.smoke.test.mjs"`
- 全通过后运行：
  - `npm run ci:check`
