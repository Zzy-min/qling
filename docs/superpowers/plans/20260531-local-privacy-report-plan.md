# `qingling` 本地数据留存报告计划（2026-05-31）

## Step 1: 测试先行

- 新增 `tests/unit/privacy-report.test.mjs`：
  - formatter 输出 workspace/state/sessions/cache。
  - formatter 输出 saved session count。
  - formatter 包含 provider 边界说明。
- 扩展 `tests/unit/slash-commands.test.mjs`：
  - `/privacy` 输出本地留存报告。
  - `/隐私` 中文别名可用。
  - `/help` 包含 `/privacy`。

## Step 2: 本地 privacy 模块

- 新增 `src/privacy-report.ts`：
  - `buildPrivacyReport(context, options)` 汇总本地路径。
  - `formatPrivacyReport(report)` 输出中文报告。

## Step 3: Slash command

- 新增 `src/commands/privacy.ts`。
- 注册到 `src/commands/index.ts`。
- 更新 `src/commands/help.ts`。

## Step 4: 验证

- `npm run build`
- `node --test "tests/unit/privacy-report.test.mjs" "tests/unit/slash-commands.test.mjs"`
- `npm run ci:check`
