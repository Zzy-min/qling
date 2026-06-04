# `qling` 阶段 B：Session Resume 与 `--continue` 计划（2026-05-16）

## Step 1: 测试先行

- 新增 `tests/unit/session-registry.test.mjs`
  - save snapshot
  - list snapshots
  - load by name
  - load by sessionId
  - load latest
- 修改 `tests/unit/cli-startup.test.mjs`
  - `--continue` 解析为 chat/repl 可用的交互恢复选项
  - `--resume <id>` 解析
  - `--continue` 与 `--resume` 冲突
  - `run --continue` / `run --resume` 报错
- 修改 `tests/unit/slash-commands.test.mjs`
  - `/sessions` 出现在 help
  - `/sessions` 输出已保存 session 摘要
  - `/resume latest`
  - `/resume <id>`
- 新增 `tests/smoke/session-resume.smoke.test.mjs`
  - checkpoint 文件真实落盘
  - restore 后保持原 `sessionId`
  - 新 session 控制器按同一个 `sessionId` 命中对应状态文件

## Step 2: 新增 Session Registry

- 新增：
  - `src/session/session-registry.ts`
- 职责：
  - 管理 snapshot 落盘
  - 列表读取
  - latest 解析
  - 通过 `name` / `sessionId` 恢复

## Step 3: 扩展 AgentLoop 会话持久化

- 修改：
  - `src/agent-loop.ts`
- 新增或扩展能力：
  - `checkpointSession()`
  - `restoreSession(nameOrSessionId)`
  - `restoreLatestSession()`
  - `listSessionsDetailed()`
  - 旧 `saveSession/loadSession/listSessions` 保持兼容包装

## Step 4: 扩展交互命令与 runtime

- 修改：
  - `src/commands/runtime.ts`
  - `src/commands/index.ts`
  - `src/commands/help.ts`
  - `src/commands/clear.ts`
  - `src/commands/compact.ts`
- 新增：
  - `src/commands/resume.ts`
  - `src/commands/sessions.ts`

## Step 5: 接线到 TUI / REPL / CLI 启动入口

- 修改：
  - `src/tui/streaming-repl.ts`
  - `src/repl.ts`
  - `src/cli/startup-contract.ts`
  - `src/index.ts`
- 目标：
  - startup `--continue` / `--resume`
  - slash `/resume`
  - session 切换后重建 scheduler / goal controller
  - 每轮成功后自动 checkpoint

## Step 6: 验证

- 运行：
  - `npm run build`
  - `node --test "tests/unit/session-registry.test.mjs"`
  - `node --test "tests/unit/cli-startup.test.mjs"`
  - `node --test "tests/unit/slash-commands.test.mjs"`
  - `node --test "tests/smoke/session-resume.smoke.test.mjs"`
- 全通过后运行：
  - `npm run ci:check`
