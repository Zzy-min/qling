# `/agents` 会话内后台任务视图实施计划（2026-06-01）

## Step 1: 测试先行

- 扩展 `tests/unit/slash-commands.test.mjs`：
  - `/help` 包含 `/agents`。
  - `/agents` 从临时 `stateDir` 读取 seeded mission。
  - `/代理` 中文别名输出同一 mission。
  - 输出不包含 fake session body。

## Step 2: Slash command 实现

- 新增 `src/commands/agents.ts`：
  - 从 `context.agentLoop.getRuntimeRootDir()` 获取 state dir。
  - 缺失时使用 `QLING_FILE_STATE_DIR` 或本机默认 `.qling`。
  - 使用 `MissionManager` 只读加载 mission。
  - 使用 `renderAgentsView()` 格式化输出。

## Step 3: 注册与帮助

- 修改 `src/commands/index.ts` 注册 `agentsCommand`。
- 修改 `src/commands/help.ts` 增加 `/agents, /代理`。

## Step 4: 验证

- `npm run build`
- `node --test "tests/unit/slash-commands.test.mjs"`
- `node --test "tests/smoke/chat-exit.smoke.test.mjs"`
- `npm run ci:check`
