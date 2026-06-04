# `qling exports` 顶层命令计划（2026-05-31）

## Step 1: 测试先行

- 扩展 `tests/unit/cli-startup.test.mjs`：
  - `parseCliArgs(["exports", "2"])` 返回 `mode=exports` 和 `subArgs=["2"]`。
  - `buildHelpText()` 包含 `qling exports [count]`。
- 扩展 `tests/smoke/cli-startup.smoke.test.mjs`：
  - 使用临时 state dir 创建 `exports/*.md`。
  - `node dist/index.js --file-state-dir <dir> exports 1` 以 0 退出。
  - stdout 包含本地导出列表、文件名和路径，不包含 Markdown 正文。

## Step 2: CLI contract

- 在 `src/cli/startup-contract.ts` 中加入 `exports` mode。
- 把 `exports` 归入顶层管理命令，保持与 `storage` 一致，不允许与 `--continue/--resume` 组合。
- 更新帮助文案。

## Step 3: CLI handler

- 在 `src/index.ts` 中导入 `formatSessionExportIndex`、`listSessionExportFiles`、`parseSessionExportCount`。
- 在 `AgentLoop` 初始化前处理 `decision.mode === "exports"`。
- 使用已加载配置构造最小 context，复用本地导出索引模块。

## Step 4: 验证

- `npm run build`
- `node --test "tests/unit/cli-startup.test.mjs" "tests/smoke/cli-startup.smoke.test.mjs"`
- `npm run ci:check`
