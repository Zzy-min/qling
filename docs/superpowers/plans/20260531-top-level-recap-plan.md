# `qingling recap` 顶层本地回顾计划（2026-05-31）

## Step 1: 测试先行

- 扩展 `tests/unit/recap.test.mjs`：
  - `parseSavedSessionRecapArgs()` 支持默认、数字 count、latest、指定 session。
  - `buildSavedSessionRecap()` 可读取最近快照和指定快照。
  - 缺失快照输出稳定空态。
- 扩展 `tests/unit/cli-startup.test.mjs`：
  - `recap` 顶层模式可解析。
  - `回顾` 中文别名可解析。
  - help 展示 `qingling recap` 和中文别名。
- 扩展 `tests/smoke/cli-startup.smoke.test.mjs`：
  - `node dist/index.js --file-state-dir <tmp> recap 1` 能读取本地快照并退出。

## Step 2: 本地快照 recap 模块

- 在 `src/recap.ts` 复用现有 formatter。
- 新增顶层快照读取函数：
  - 使用 `SessionRegistry.loadLatest()` 或 `SessionRegistry.load(ref)`。
  - 将 saved session snapshot 转成 `formatLocalRecap()` 输入。
  - 保持只读、无网络、无模型调用。

## Step 3: CLI 注册

- 在 `src/cli/startup-contract.ts` 新增 `recap` 管理模式和 `回顾` 顶层别名。
- 更新 help 文案。
- 在 `src/index.ts` 的 AgentLoop 实例化之前处理 `decision.mode === "recap"`。

## Step 4: 验证

- `npm run build`
- `node --test "tests/unit/recap.test.mjs" "tests/unit/cli-startup.test.mjs" "tests/smoke/cli-startup.smoke.test.mjs"`
- `npm run ci:check`
