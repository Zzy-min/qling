# `qling` 本地存储盘点计划（2026-05-31）

## Step 1: 测试先行

- 新增 `tests/unit/local-storage-report.test.mjs`：
  - 缺失 state 子目录时稳定返回 missing。
  - sessions/exports/cache 存在时统计文件数量、目录数量和字节数。
  - 扫描上限触发时标记 truncated。
  - formatter 输出路径和元数据，但不输出文件正文。
- 扩展 `tests/unit/slash-commands.test.mjs`：
  - `/help` 包含 `/storage`。
  - `/storage` 输出本地存储盘点。
  - `/存储` 中文别名可用。

## Step 2: 存储盘点模块

- 新增 `src/local-storage-report.ts`：
  - 解析 state/cache/sessions/exports 路径。
  - 递归扫描目录元数据，限制最大扫描项数。
  - 格式化只读报告。

## Step 3: Slash command

- 新增 `src/commands/storage.ts`。
- 注册到 `src/commands/index.ts`。
- 更新 `src/commands/help.ts`。

## Step 4: 验证

- `npm run build`
- `node --test "tests/unit/local-storage-report.test.mjs" "tests/unit/slash-commands.test.mjs"`
- `npm run ci:check`
