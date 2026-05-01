# `qingling` REPL 退出挂起修复计划（2026-05-01）

## Step 1: 代码修复
- 修改 `src/repl.ts`：在 `q/quit/exit` 分支补充 `await agent.shutdown()`，再关闭 readline。

## Step 2: 回归测试
- 新增 `tests/smoke/repl-shutdown.smoke.test.mjs`：
  - 启动 `dist/index.js repl --api-key test-key`
  - 写入 `exit`
  - 校验进程在超时前退出（exit code 0）

## Step 3: 验证
- 执行 `npm run ci:check`。
- 如失败，先修复测试稳定性，再重新验证。
