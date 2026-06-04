# `qling` 阶段 B：`permissions.mode` 兼容映射计划（2026-05-17）

## Step 1: 测试先行

- 修改 `tests/unit/config.test.mjs`：
  - 新增 `permissions.mode` 文件配置映射测试
  - 新增 `QLING_PERMISSIONS_MODE` 环境变量映射测试

## Step 2: 配置加载与导出实现

- 修改 `src/config.ts`：
  - 增加 `permissions.mode` -> `guard.permissions.default` 归一化
  - 增加 `QLING_PERMISSIONS_MODE` 环境变量兼容
  - `applyConfigToProcessEnv` 同步导出两套变量

## Step 3: Slash 命令一致性

- 修改 `src/commands/permissions.ts`：
  - 切换模式时同时写 `QLING_PERMISSIONS_MODE`

## Step 4: 验证

- `npm run build`
- `node --test "tests/unit/config.test.mjs"`
- `npm run ci:check`
