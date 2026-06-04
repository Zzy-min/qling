# `qling privacy` 顶层命令计划（2026-05-31）

## Step 1: 测试先行

- 扩展 `tests/unit/privacy-report.test.mjs`：
  - 新增本地 builder 测试，临时 state dir 内有会话快照时只统计摘要数量，不暴露正文。
- 扩展 `tests/unit/cli-startup.test.mjs`：
  - `parseCliArgs(["privacy"])` 返回 `mode=privacy`。
  - `buildHelpText()` 包含 `qling privacy`。
- 扩展 `tests/smoke/cli-startup.smoke.test.mjs`：
  - `node dist/index.js --file-state-dir <tmp> privacy` 以 0 退出。
  - stdout 包含“本地数据留存”和会话数量，不包含会话正文。

## Step 2: Privacy report 模块

- 在 `src/privacy-report.ts` 增加 `buildLocalPrivacyReport(options)`。
- 使用 `SessionRegistry` 读取本地会话摘要数量。
- 保持 formatter 输出字段稳定，继续说明 provider 边界。

## Step 3: CLI contract

- 在 `src/cli/startup-contract.ts` 中加入 `privacy` mode。
- 把 `privacy` 归入顶层管理命令，保持与 `doctor/storage/exports/sessions` 一致，不允许与 `--continue/--resume` 组合。
- 更新帮助文案。

## Step 4: CLI handler

- 在 `src/index.ts` 中导入 `buildLocalPrivacyReport` 和 `formatPrivacyReport`。
- 在 `AgentLoop` 初始化前处理 `decision.mode === "privacy"`。
- 使用已加载配置传入 workspace/state/cache/model。

## Step 5: 验证

- `npm run build`
- `node --test "tests/unit/privacy-report.test.mjs" "tests/unit/cli-startup.test.mjs" "tests/smoke/cli-startup.smoke.test.mjs"`
- `npm run ci:check`
