# `qingling statusline` 顶层命令计划（2026-05-31）

## Step 1: 测试先行

- 扩展 `tests/unit/statusline.test.mjs`：
  - 新增 local snapshot 测试，临时 `.git/HEAD` 为 `main` 时输出 `branch=main`。
  - 确认模型和权限模式来自传入配置。
- 扩展 `tests/unit/cli-startup.test.mjs`：
  - `parseCliArgs(["statusline"])` 返回 `mode=statusline`。
  - `parseCliArgs(["状态线"])` 返回 `mode=statusline`。
  - help 包含 `qingling statusline` 和 `状态线`。
- 扩展 `tests/smoke/cli-startup.smoke.test.mjs`：
  - `node dist/index.js --workspace <tmp> --model local-status 状态线` 以 0 退出。
  - stdout 包含 `model=local-status`、`branch=main`、`session=-`。

## Step 2: Statusline 模块

- 在 `src/statusline.ts` 增加 `collectLocalStatusLineSnapshot(options)`。
- 复用 `formatStatusLine()` 和 `resolveGitBranch()`。
- 顶层模式无 session/task/goal/token 时填入安全默认值。

## Step 3: CLI contract

- 在 `src/cli/startup-contract.ts` 中加入 `statusline` mode。
- 将 `statusline` 归入顶层管理命令。
- 将 `状态线` 加入顶层中文 alias 表。
- 更新 help 文案。

## Step 4: CLI handler

- 在 `src/index.ts` 中导入 `collectLocalStatusLineSnapshot` 和 `formatStatusLine`。
- 在 `AgentLoop` 初始化前处理 `decision.mode === "statusline"`。
- 使用加载后的配置传入 workspace、model、permission mode。

## Step 5: 验证

- `npm run build`
- `node --test "tests/unit/statusline.test.mjs" "tests/unit/cli-startup.test.mjs" "tests/smoke/cli-startup.smoke.test.mjs"`
- `npm run ci:check`
