# `doctor` 本地可观测链路汇总实施计划（2026-06-01）

## Step 1: 测试先行

- 扩展 `tests/unit/doctor.test.mjs`：
  - `buildDoctorReport` 输出 `config`、`mcp`、`hooks` checks。
  - config endpoint 与 api key 脱敏。
  - mcp URL/header secret 不泄露。
  - hooks custom pattern 与 permission reason 不泄露。
- 扩展 `tests/smoke/cli-startup.smoke.test.mjs`：
  - `doctor` smoke 输出 `config`、`MCP`、`hooks`。

## Step 2: Doctor 汇总实现

- 在 `src/doctor.ts` 中复用现有脱敏/汇总模块：
  - `sanitizeEndpoint` 用于 endpoint。
  - `buildLocalMcpReport` 用于 MCP 计数。
  - `guardConfigFromEnv` 与 `buildLocalHooksReport` 用于 hooks 摘要。
- 仅输出摘要，不输出原始配置对象。

## Step 3: 验证

- `npm run build`
- `node --test "tests/unit/doctor.test.mjs" "tests/smoke/cli-startup.smoke.test.mjs"`
- `npm run ci:check`
