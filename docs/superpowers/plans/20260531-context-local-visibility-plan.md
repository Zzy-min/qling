# `qingling` 交互体验：本地 `/context` 可视化实施计划（2026-05-31）

## Step 1: 测试先行

- 新增 `tests/unit/context-report.test.mjs`：
  - 构建 report 时包含 session/message/token/compaction。
  - token budget 百分比正确降级。
  - 无 saved sessions 时报告为 0。
- 扩展 `tests/unit/slash-commands.test.mjs`：
  - `/context` 输出本地上下文报告。
  - `/上下文` 中文别名可用。

## Step 2: 本地 context report 模块

- 新增 `src/context-report.ts`：
  - `buildContextReport(context)` 从 AgentLoop 与 context 中读取本地状态。
  - `formatContextReport(report)` 输出可读报告。

## Step 3: Slash command 接入

- 新增 `src/commands/context.ts`。
- 注册到 `src/commands/index.ts`。
- 更新 `src/commands/help.ts`。

## Step 4: 验证

- `npm run build`
- `node --test "tests/unit/context-report.test.mjs" "tests/unit/slash-commands.test.mjs"`
- `npm run ci:check`
