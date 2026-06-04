# `qling storage` 顶层命令计划（2026-05-31）

## Step 1: 测试先行

- 扩展 `tests/unit/cli-startup.test.mjs`：
  - `parseCliArgs(["storage"])` 返回 `mode=storage`。
  - `buildHelpText()` 包含 `qling storage`。
- 扩展 `tests/smoke/cli-startup.smoke.test.mjs`：
  - `node dist/index.js storage` 以 0 退出。
  - stdout 包含“本地存储盘点”和 state/sessions/cache 等关键词。

## Step 2: CLI contract

- 在 `src/cli/startup-contract.ts` 中加入 `storage` mode。
- 把 `storage` 归入顶层管理命令，保持与 `doctor` 一致，不允许与 `--continue/--resume` 组合。
- 更新帮助文案。

## Step 3: CLI handler

- 在 `src/index.ts` 中导入 `buildLocalStorageReport` 和 `formatLocalStorageReport`。
- 在 `AgentLoop` 初始化前处理 `decision.mode === "storage"`。
- 使用已加载配置构造最小 context，复用本地报告模块。

## Step 4: 验证

- `npm run build`
- `node --test "tests/unit/cli-startup.test.mjs" "tests/smoke/cli-startup.smoke.test.mjs"`
- `npm run ci:check`
