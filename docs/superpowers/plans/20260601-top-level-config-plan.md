# `qingling config` 顶层本地配置摘要计划（2026-06-01）

## Step 1: 测试先行

- 新增 `tests/unit/config-report.test.mjs`：
  - API key 存在时只输出 `set(redacted)`。
  - API key 缺失时输出 `missing`。
  - endpoint 去除 userinfo、query、hash。
  - 主要 runtime、permission、feature 字段可读。
- 扩展 `tests/unit/cli-startup.test.mjs`：
  - `config` 顶层模式可解析。
  - `配置` 中文别名可解析。
  - help 展示 `qingling config` 和中文别名。
- 扩展 `tests/smoke/cli-startup.smoke.test.mjs`：
  - `node dist/index.js 配置` 在 env model/api key 下输出配置摘要并退出。
  - stdout 不包含 secret 原文。

## Step 2: 配置报告模块

- 新增 `src/config-report.ts`：
  - `buildLocalConfigReport(config)` 将当前生效配置转换为摘要对象。
  - `formatLocalConfigReport(report)` 输出固定中文报告。
  - 包含专用 secret 与 endpoint 脱敏函数。

## Step 3: CLI 注册

- 在 `src/cli/startup-contract.ts` 新增 `config` 管理模式和 `配置` 顶层别名。
- 更新 help。
- 在 `src/index.ts` 的 AgentLoop 实例化之前处理 `decision.mode === "config"`。

## Step 4: 验证

- `npm run build`
- `node --test "tests/unit/config-report.test.mjs" "tests/unit/cli-startup.test.mjs" "tests/smoke/cli-startup.smoke.test.mjs"`
- `npm run ci:check`
