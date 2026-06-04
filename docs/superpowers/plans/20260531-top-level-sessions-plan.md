# `qingling sessions` 顶层命令计划（2026-05-31）

## Step 1: 测试先行

- 新增 `tests/unit/session-list-report.test.mjs`：
  - count 解析默认值、非法值和上限截断。
  - formatter 输出会话摘要。
  - formatter 不输出消息正文。
- 扩展 `tests/unit/cli-startup.test.mjs`：
  - `parseCliArgs(["sessions", "2"])` 返回 `mode=sessions`。
  - `buildHelpText()` 包含 `qingling sessions [count]`。
- 扩展 `tests/smoke/cli-startup.smoke.test.mjs`：
  - 临时 state dir 写入 session snapshot。
  - `node dist/index.js --file-state-dir <dir> sessions 1` 输出会话摘要且不泄露消息正文。

## Step 2: 会话列表模块

- 新增 `src/session-list-report.ts`：
  - `parseSessionListCount(value)`。
  - `listLocalSessions(stateDir, count)`。
  - `formatSessionListReport(report)`。
- 底层使用 `SessionRegistry.list()` 获取本地摘要。

## Step 3: CLI contract 和 handler

- 在 `src/cli/startup-contract.ts` 中加入 `sessions` mode。
- 更新帮助文案。
- 在 `src/index.ts` 的 AgentLoop 初始化前处理 `decision.mode === "sessions"`。

## Step 4: 验证

- `npm run build`
- `node --test "tests/unit/session-list-report.test.mjs" "tests/unit/cli-startup.test.mjs" "tests/smoke/cli-startup.smoke.test.mjs"`
- `npm run ci:check`
