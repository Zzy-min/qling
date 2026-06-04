# `qingling` 阶段 B：`agents.isolation.*` 契约收敛计划（2026-05-17）

## Step 1: 测试先行

- 修改 `tests/unit/config.test.mjs`：
  - 增加 `agents.isolation.*` 配置加载与 env 映射测试。
- 新增 `tests/unit/isolation-policy.test.mjs`：
  - Git workspace 判定
  - 非 Git + warn
  - 非 Git + deny

## Step 2: 配置与导出实现

- 修改 `src/config.ts`：
  - 增加 `agents.isolation.*` 类型与默认值。
  - `applyConfigToProcessEnv` 导出对应环境变量。

## Step 3: 隔离策略评估器与接入

- 新增 `src/agents/isolation-policy.ts`：
  - 统一评估 Git/非 Git 隔离策略。
- 修改 `src/commands/loop.ts`：
  - `/loop daemon` 前置执行隔离策略检查。

## Step 4: 可见性补齐

- 修改 `src/commands/config.ts`：
  - 输出当前 isolation 配置摘要。

## Step 5: 验证

- `npm run build`
- `node --test "tests/unit/config.test.mjs"`
- `node --test "tests/unit/isolation-policy.test.mjs"`
- `npm run ci:check`
