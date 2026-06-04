# `qling permissions` 顶层权限状态计划（2026-06-01）

## Step 1: 测试先行

- 新增 `tests/unit/permissions-report.test.mjs`：
  - 默认 mode 格式化。
  - rules 列表展示。
  - 无规则空态。
  - 环境变量覆盖来源展示。
- 扩展 `tests/unit/cli-startup.test.mjs`：
  - `permissions` 顶层模式可解析。
  - `权限` 中文别名可解析。
  - help 展示 `qling permissions` 和中文别名。
- 扩展 `tests/smoke/cli-startup.smoke.test.mjs`：
  - `node dist/index.js permissions` 在 `QLING_PERMISSIONS_MODE=ask` 下输出 ask 并退出。

## Step 2: 权限报告模块

- 新增 `src/permissions-report.ts`：
  - 接收 `defaultMode`、`rules`、`env`。
  - 输出固定中文报告。
  - 只做展示，不写配置、不改环境。

## Step 3: CLI 注册

- 在 `src/cli/startup-contract.ts` 新增 `permissions` 管理模式和 `权限` 顶层别名。
- 更新顶层 help。
- 在 `src/index.ts` 的 AgentLoop 实例化之前处理 `decision.mode === "permissions"`。

## Step 4: 验证

- `npm run build`
- `node --test "tests/unit/permissions-report.test.mjs" "tests/unit/cli-startup.test.mjs" "tests/smoke/cli-startup.smoke.test.mjs"`
- `npm run ci:check`
