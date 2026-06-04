# `qling` 本地会话导出计划（2026-05-31）

## Step 1: 测试先行

- 新增 `tests/unit/session-export.test.mjs`：
  - formatter 输出 session metadata。
  - formatter 输出消息角色和正文。
  - 空消息稳定降级。
  - export writer 写入本地 Markdown 文件。
- 扩展 `tests/unit/slash-commands.test.mjs`：
  - `/help` 包含 `/export`。
  - `/export` 输出生成路径。
  - `/导出` 中文别名可用。

## Step 2: 导出模块

- 新增 `src/session-export.ts`：
  - `formatSessionExportMarkdown(snapshot)`。
  - `buildSessionExportSnapshot(context)`。
  - `writeSessionExport(context, options)`。

## Step 3: Slash command

- 新增 `src/commands/export.ts`。
- 注册到 `src/commands/index.ts`。
- 更新 `src/commands/help.ts`。

## Step 4: 验证

- `npm run build`
- `node --test "tests/unit/session-export.test.mjs" "tests/unit/slash-commands.test.mjs"`
- `npm run ci:check`
