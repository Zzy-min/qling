# `qling shortcuts` 顶层命令计划（2026-05-31）

## Step 1: 测试先行

- 扩展 `tests/unit/cli-startup.test.mjs`：
  - `parseCliArgs(["shortcuts"])` 返回 `mode=shortcuts`。
  - `parseCliArgs(["快捷键"])` 返回 `mode=shortcuts`。
  - help 包含 `qling shortcuts` 和 `快捷键`。
- 扩展 `tests/smoke/cli-startup.smoke.test.mjs`：
  - `node dist/index.js 快捷键` 以 0 退出。
  - stdout 包含“TUI 快捷键”、`Ctrl+N`、`Ctrl+R` 和本地说明。

## Step 2: 复用快捷键文案

- 新增 `src/shortcuts.ts` 导出 `SHORTCUT_LINES`。
- 更新 `src/commands/shortcuts.ts` 从共享模块导入文案。

## Step 3: CLI contract

- 在 `src/cli/startup-contract.ts` 中加入 `shortcuts` mode。
- 将 `shortcuts` 归入顶层管理命令。
- 将 `快捷键` 加入顶层中文 alias 表。
- 更新 help 文案。

## Step 4: CLI handler

- 在 `src/index.ts` 中导入 `SHORTCUT_LINES`。
- 在 `AgentLoop` 初始化前处理 `decision.mode === "shortcuts"`。
- 直接输出共享文案后退出。

## Step 5: 验证

- `npm run build`
- `node --test "tests/unit/cli-startup.test.mjs" "tests/smoke/cli-startup.smoke.test.mjs"`
- `npm run ci:check`
