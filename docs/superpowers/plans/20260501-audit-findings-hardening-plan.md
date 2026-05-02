# `qingling` 审查发现修复计划（2026-05-01）

## Step 1: 参数解析与重复调用治理
- 修改 `src/agent-loop.ts`：
  - 增加 `tool_calls` 参数解析重试函数。
  - 无法解析时产出 `TOOL_INVALID_ARGUMENTS` 错误结果，不中断主循环。
  - 增加同签名工具调用重复限制，接入 `runtime.tool_repeat_limit`。
  - 接入 `QINGLING_LLM_REQUEST_TIMEOUT_MS` 到 LLM HTTP client timeout。

## Step 2: chat 模式生命周期修复
- 修改 `src/tui/streaming-repl.ts` 与 `src/tui/streaming-tui.ts`：
  - 支持 `q/quit/exit` 退出。
  - 退出时执行 `agent.shutdown()`。
  - 释放 stdin 监听并结束 REPL 生命周期（不直接粗暴 `process.exit(0)`）。
- 修改 `src/index.ts`：chat 分支改为等待 REPL 结束。

## Step 3: Slack 审批并发安全修复
- 修改 `src/channels/slack-channel.ts`：
  - 使用 pending map + 命令解析路由审批。
  - 移除覆盖 `userMessageHandler` 的实现。
  - 增加审批 TTL 清理。

## Step 4: 测试补强
- 新增/修改测试：
  - `tests/unit/agent-loop-tool-args.test.mjs`
  - `tests/unit/slack-channel.test.mjs`
  - 必要时补 `tests/smoke` 回归。

## Step 5: 验证
- 运行：
  - `npm run build`
  - `npm test`
  - `npm run test:smoke`
  - `npm audit --omit=dev --registry=https://registry.npmjs.org --json`
