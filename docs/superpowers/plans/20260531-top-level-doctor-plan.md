# `qingling` 顶层 Doctor 命令实施计划（2026-05-31）

## Step 1: 测试先行

- 修改 `tests/unit/cli-startup.test.mjs`：
  - `doctor` 被解析为独立管理命令。
  - help 包含 `qingling doctor`。
- 修改 `tests/smoke/cli-startup.smoke.test.mjs`：
  - `node dist/index.js doctor` 退出码为 0。
  - stdout 包含 `轻灵 Doctor`、`workspace`、`本地`。

## Step 2: CLI 路由

- 修改 `src/cli/startup-contract.ts`：
  - `CliMode` 增加 `doctor`。
  - known modes 和管理命令集合包含 `doctor`。
  - help 增加 `qingling doctor`。

## Step 3: index 管理分支

- 修改 `src/index.ts`：
  - 在配置加载和 `applyConfigToProcessEnv` 后、AgentLoop 初始化前处理 `decision.mode === "doctor"`。
  - 使用 `buildDoctorReport` 与 `formatDoctorReport` 输出报告。

## Step 4: 验证

- `npm run build`
- `node --test "tests/unit/cli-startup.test.mjs" "tests/smoke/cli-startup.smoke.test.mjs"`
- `npm run ci:check`
