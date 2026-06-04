# `qingling hooks` / `/hooks` 本地 Hooks 可视化实施计划（2026-06-01）

## Step 1: 测试先行

- 新增 `tests/unit/hooks-report.test.mjs`：
  - 默认配置输出稳定本地 hooks 摘要。
  - rate limit、content filter、permissions、audit、redaction、network 字段可见。
  - 自定义 pattern 正文不出现在输出里。
- 扩展 `tests/unit/cli-startup.test.mjs`：
  - `hooks` 顶层模式可解析。
  - `钩子` 顶层中文别名可解析。
  - help 展示 `qingling hooks` 与 `钩子`。
- 扩展 `tests/unit/slash-commands.test.mjs`：
  - `/help` 展示 `/hooks` 与 `/钩子`。
  - `/hooks` 输出本地 hooks 摘要且不泄露 custom pattern。
  - `/钩子` 与英文命令行为一致。
- 扩展 `tests/unit/config.test.mjs`：
  - `applyConfigToProcessEnv` 映射 guard rate/content 字段。
- 扩展 `tests/smoke/cli-startup.smoke.test.mjs`：
  - `node dist/index.js 钩子` 只读输出 hooks 摘要并退出。

## Step 2: Hooks 报告模块

- 新增 `src/hooks-report.ts`：
  - `buildLocalHooksReport(guardConfig)` 汇总 guard/hooks 状态。
  - `formatLocalHooksReport(report)` 输出固定中文报告。
  - 对 custom patterns 只输出数量，不输出正文。

## Step 3: CLI 与 Slash 接入

- 新增 `src/commands/hooks.ts`。
- 注册到 `src/commands/index.ts`。
- 更新 `src/commands/help.ts`。
- 在 `src/cli/startup-contract.ts` 新增 `hooks` 管理模式与中文别名 `钩子`。
- 在 `src/index.ts` 的 AgentLoop 实例化之前处理 `decision.mode === "hooks"`。

## Step 4: 配置环境映射

- 在 `applyConfigToProcessEnv` 中补齐：
  - `QINGLING_GUARD_RATE_LIMIT_ENABLED`
  - `QINGLING_GUARD_RATE_LIMIT_MAX_PER_MINUTE`
  - `QINGLING_GUARD_CONTENT_FILTER_ENABLED`
  - `QINGLING_GUARD_CONTENT_FILTER_PII`
  - `QINGLING_GUARD_CONTENT_FILTER_INJECTION`
  - `QINGLING_GUARD_CONTENT_FILTER_CUSTOM`
  - `QINGLING_GUARD_PERMISSIONS_RULES`

## Step 5: 验证

- `npm run build`
- `node --test "tests/unit/hooks-report.test.mjs" "tests/unit/cli-startup.test.mjs" "tests/unit/slash-commands.test.mjs" "tests/unit/config.test.mjs" "tests/smoke/cli-startup.smoke.test.mjs"`
- `npm run ci:check`
