# `qingling` TUI 模式指示计划（2026-05-31）

## Step 1: 测试先行

- 扩展 `tests/unit/statusline.test.mjs`：
  - `formatPermissionMode("allow")`。
  - `formatPermissionMode("ask")`。
  - `formatPermissionMode("deny")`。
  - 缺失模式降级。
  - `formatStatusLine()` 使用可解释权限文本。
- 扩展 `tests/unit/slash-commands.test.mjs`：
  - `/permissions status` 输出当前模式说明。

## Step 2: 统一 formatter

- 修改 `src/statusline.ts`：
  - 新增并导出 `formatPermissionMode()`。
  - `formatStatusLine()` 使用该函数。

## Step 3: Slash command 复用

- 修改 `src/commands/permissions.ts`：
  - 复用 `formatPermissionMode()`。
  - 状态查询和切换结果都输出同一解释。

## Step 4: 验证

- `npm run build`
- `node --test "tests/unit/statusline.test.mjs" "tests/unit/slash-commands.test.mjs"`
- `npm run ci:check`
