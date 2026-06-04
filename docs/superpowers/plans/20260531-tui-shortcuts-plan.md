# `qling` TUI 快捷键帮助计划（2026-05-31）

## Step 1: 测试先行

- 扩展 `tests/unit/slash-commands.test.mjs`：
  - `/help` 包含 `/shortcuts`。
  - `/shortcuts` 输出 `Ctrl+N`、`Ctrl+R`、`Ctrl+C`。
  - `/快捷键` 中文别名可用。

## Step 2: Shortcut command

- 新增 `src/commands/shortcuts.ts`：
  - 导出静态 `SHORTCUT_LINES`。
  - `execute()` 逐行输出。

## Step 3: 注册与帮助

- 修改 `src/commands/index.ts` 注册 `shortcutsCommand`。
- 修改 `src/commands/help.ts` 增加 `/shortcuts, /快捷键`。

## Step 4: 验证

- `npm run build`
- `node --test "tests/unit/slash-commands.test.mjs"`
- `npm run ci:check`
