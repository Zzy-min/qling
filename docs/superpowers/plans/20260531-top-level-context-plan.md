# `qingling context` 顶层命令计划（2026-05-31）

## Step 1: 测试先行

- 扩展 `tests/unit/context-report.test.mjs`：
  - 新增 `buildLocalContextReport()` 测试，临时 state dir 内有 session 快照时统计数量和最近保存时间。
  - 确认 formatter 不输出消息正文。
- 扩展 `tests/unit/cli-startup.test.mjs`：
  - `parseCliArgs(["context"])` 返回 `mode=context`。
  - `parseCliArgs(["上下文"])` 返回 `mode=context`。
  - help 包含 `qingling context` 和 `上下文`。
- 扩展 `tests/smoke/cli-startup.smoke.test.mjs`：
  - `node dist/index.js --file-state-dir <tmp> 上下文` 以 0 退出。
  - stdout 包含“本地上下文”和保存快照数量，不包含 session 正文。

## Step 2: Context report 模块

- 在 `src/context-report.ts` 增加 `buildLocalContextReport(options)`。
- 使用 `SessionRegistry` 获取本地会话摘要。
- 顶层模式无活动 session，因此 session/turn/message/token 相关字段使用安全占位值。

## Step 3: CLI contract

- 在 `src/cli/startup-contract.ts` 中加入 `context` mode。
- 将 `context` 归入顶层管理命令。
- 将 `上下文` 加入顶层中文 alias 表。
- 更新 help 文案。

## Step 4: CLI handler

- 在 `src/index.ts` 中导入 `buildLocalContextReport` 和 `formatContextReport`。
- 在 `AgentLoop` 初始化前处理 `decision.mode === "context"`。
- 使用已加载配置传入 workspace/state/cache/max token budget。

## Step 5: 验证

- `npm run build`
- `node --test "tests/unit/context-report.test.mjs" "tests/unit/cli-startup.test.mjs" "tests/smoke/cli-startup.smoke.test.mjs"`
- `npm run ci:check`
