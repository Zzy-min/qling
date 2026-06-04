# `qling` P1 Follow-up Findings 修复计划（2026-04-30）

## Step 1: 退出生命周期
- 修改 `src/index.ts`：
  - `run` 分支用 `try/finally` 执行 `agent.shutdown()`
  - 保持错误码行为不变

## Step 2: 配置生效链路
- 修改 `src/config.ts`：
  - 扩展 `applyConfigToProcessEnv()` 写入 memory/mcp/metrics/channels 环境变量
- 修改 `src/agent-loop.ts`：
  - 使用 env 驱动 memory/mcp/metrics 参数
  - 修复 projection interval 实际应用

## Step 3: Telegram 通道补全
- 修改 `src/channels/telegram-channel.ts`：
  - 实现 `sendText()` -> `sendMessage`
  - 实现审批消息 + inline keyboard
  - 完整 callback 解析和 pending 释放

## Step 4: Subtask 工具接线
- 修改 `src/tools/subtask.ts`：
  - 新增 `runSubtask()` 执行逻辑
- 修改 `src/tools/index.ts`：
  - 将 `subtaskTool` 加入 `ALL_TOOLS`
  - 注册 `subtask` handler

## Step 5: 测试与验证
- 新增/更新单测：
  - 配置 env 映射
  - tool registry 包含 subtask
  - run-mode 退出行为（smoke 侧覆盖）
  - telegram 关键行为单测（mock axios）
- 执行：
  - `npm run build`
  - `npm test`
  - `npm run test:smoke`
