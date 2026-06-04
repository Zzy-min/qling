# `qling` 阶段 B：`/permissions` 命令补齐计划（2026-05-17）

## Step 1: 测试先行

- 修改 `tests/unit/slash-commands.test.mjs`：
  - 新增 `/permissions` 查询测试
  - 新增 `/permissions deny` 切换测试
  - 新增非法参数测试
  - 将 `/help` 断言补充 `/permissions`

## Step 2: 命令实现

- 新增 `src/commands/permissions.ts`
  - 支持 `status`/空参数
  - 支持 `allow|deny|ask` 切换
  - 支持中文别名 `/权限`

## Step 3: 运行态权限更新能力

- 修改 `src/pipeline/hooks.ts`
  - 增加获取/更新默认权限决策的接口
- 修改 `src/agent-loop.ts`
  - 暴露 `getPermissionMode()` / `setPermissionMode()`

## Step 4: 命令注册与帮助一致性

- 修改：
  - `src/commands/help.ts`
  - `src/commands/index.ts`

## Step 5: 验证

- `npm run build`
- `node --test "tests/unit/slash-commands.test.mjs"`
- `npm run ci:check`
