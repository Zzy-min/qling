# `qingling` 交互体验：本地状态线实施计划（2026-05-31）

## Step 1: 测试先行

- 新增 `tests/unit/statusline.test.mjs`：
  - formatter 输出 model/session/branch/permission/goal/tasks/tokens。
  - session id 超长时缩短显示。
  - 缺失 git 分支时稳定降级。
- 扩展 `tests/unit/slash-commands.test.mjs`：
  - `/statusline` 查看当前状态。
  - `/statusline off` 关闭。
  - `/statusline on` 开启。
  - `/状态线` 中文别名。

## Step 2: 状态线核心模块

- 新增 `src/statusline.ts`：
  - `collectStatusLineSnapshot(context)` 汇总本地状态。
  - `formatStatusLine(snapshot)` 生成紧凑展示字符串。
  - `resolveGitBranch(workspaceDir)` 只读取本地 git。

## Step 3: Slash command

- 新增 `src/commands/statusline.ts`。
- 注册到 `src/commands/index.ts`。
- 更新 `src/commands/help.ts`。
- 扩展 `SlashCommandContext`，加入 `statusLine` 控制接口。

## Step 4: TUI 接入

- 扩展 `StreamUI` 支持 prompt 前状态线 provider。
- `StreamingREPL` 提供本地 statusline provider，并通过 `/statusline on|off` 切换。
- 保持非 TUI slash command 可测试、可直接输出。

## Step 5: 验证

- `npm run build`
- `node --test "tests/unit/statusline.test.mjs" "tests/unit/slash-commands.test.mjs"`
- `npm run ci:check`
