# `/mission` 会话内本地任务管理实施计划（2026-06-01）

## Step 1: 测试先行

- 扩展 `tests/unit/slash-commands.test.mjs`：
  - `/help` 包含 `/mission`。
  - `/mission show <id>` 输出 seeded mission 详情。
  - `/mission logs <id>` 输出 seeded mission logs。
  - `/mission terminate <id>` 将 queued mission 置为 canceled。
  - `/使命 查看 <id>` 与英文 show 行为一致。
  - 输出不包含 fake session body。

## Step 2: Slash command 实现

- 新增 `src/commands/mission.ts`：
  - 解析英文/中文子命令。
  - 从 `context.agentLoop.getRuntimeRootDir()` 或本机默认 state dir 定位 mission store。
  - 使用 `MissionManager` 加载和控制 mission。
  - 对 list 复用 `renderAgentsView()`。
  - 对 logs 复用 `renderMissionEvents()`。

## Step 3: 注册与帮助

- 修改 `src/commands/index.ts` 注册 `missionCommand`。
- 修改 `src/commands/help.ts` 增加 `/mission, /使命`。

## Step 4: 验证

- `npm run build`
- `node --test "tests/unit/slash-commands.test.mjs"`
- `node --test "tests/smoke/mission-cli.smoke.test.mjs"`
- `npm run ci:check`
