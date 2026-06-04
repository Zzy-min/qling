# Mission 中文别名与终止别名实施计划（2026-06-01）

## Step 1: 测试先行

- 扩展 `tests/unit/cli-startup.test.mjs`：
  - `使命 列表` 解析为 `mode=mission` 且保留子参数。
  - `代理` 解析为 `mode=agents`。
  - `日志 <id>` 解析为 `mode=logs`。
  - help 包含 `使命`、`代理`、`日志`、`terminate`。
- 扩展 `tests/smoke/agents-view.smoke.test.mjs`：
  - `使命 列表` 在无 API key 下读取 seeded mission。
  - `使命 日志 <id>` 读取 seeded log。
  - `日志 <id>` 顶层中文别名读取 seeded log。

## Step 2: CLI 顶层别名

- 修改 `src/cli/startup-contract.ts`：
  - 在 `TOP_LEVEL_MODE_ALIASES` 中加入 `使命`、`代理`、`日志`。
  - 在 help 文案中加入后台 mission 中文别名。

## Step 3: Mission 子命令归一化

- 修改 `src/index.ts`：
  - 扩展 `normalizeMissionSubcommand()`，统一处理中英文子命令和 `terminate`。
  - 更新 usage 文案，包含中文别名和 `terminate`。

## Step 4: 验证

- `npm run build`
- `node --test "tests/unit/cli-startup.test.mjs" "tests/smoke/agents-view.smoke.test.mjs"`
- `npm run ci:check`
