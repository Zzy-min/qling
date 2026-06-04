# `qingling` 本地会话回顾计划（2026-05-31）

## Step 1: 测试先行

- 新增 `tests/unit/recap.test.mjs`：
  - formatter 输出 session stats、goal、tasks、workspace。
  - 最近消息按数量限制。
  - 空消息稳定降级。
- 扩展 `tests/unit/slash-commands.test.mjs`：
  - `/recap` 输出本地回顾。
  - `/回顾` 中文别名可用。
  - `/help` 包含 `/recap`。

## Step 2: 本地 recap 模块

- 新增 `src/recap.ts`：
  - `buildRecap(context, options)` 汇总本地状态。
  - `formatRecapMessage()` 对消息做单行短摘录。
  - `formatLocalRecap()` 输出中文可读报告。

## Step 3: Slash command

- 新增 `src/commands/recap.ts`。
- 注册到 `src/commands/index.ts`。
- 更新 `src/commands/help.ts`。

## Step 4: 验证

- `npm run build`
- `node --test "tests/unit/recap.test.mjs" "tests/unit/slash-commands.test.mjs"`
- `npm run ci:check`
