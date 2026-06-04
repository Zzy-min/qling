# `qling` 本地导出索引计划（2026-05-31）

## Step 1: 测试先行

- 新增 `tests/unit/session-export-index.test.mjs`：
  - 缺失导出目录返回空列表。
  - 空目录返回空列表。
  - `.md` 文件按 `mtime` 倒序列出。
  - `count` 缺省、非法、小于等于 0 和超过上限的处理稳定。
  - 格式化输出包含文件名、修改时间、大小、路径，且不包含文件正文。
- 扩展 `tests/unit/slash-commands.test.mjs`：
  - `/help` 包含 `/exports`。
  - `/exports` 列出临时 state dir 中的导出文件。
  - `/导出列表` 中文别名可用。

## Step 2: 导出索引模块

- 新增 `src/session-export-index.ts`：
  - `parseSessionExportCount(value)`。
  - `listSessionExportFiles(context, options)`。
  - `formatSessionExportIndex(report)`。
- 扩展 `src/session-export.ts`，导出统一的 exports 目录解析函数，避免 `/export` 与 `/exports` 路径漂移。

## Step 3: Slash command

- 新增 `src/commands/exports.ts`。
- 注册到 `src/commands/index.ts`。
- 更新 `src/commands/help.ts`。

## Step 4: 验证

- `npm run build`
- `node --test "tests/unit/session-export-index.test.mjs" "tests/unit/slash-commands.test.mjs"`
- `npm run ci:check`
