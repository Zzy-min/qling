# `qling` TUI 长任务进度反馈计划（2026-05-31）

## Step 1: 测试先行

- 新增 `tests/unit/tui-progress.test.mjs`：
  - `formatProgressPulse()` 输出阶段名。
  - 秒级和分钟级 elapsed 格式稳定。
  - 空阶段名降级为 `agent`。

## Step 2: 进度 formatter

- 新增 `src/tui/progress.ts`：
  - `formatProgressDuration(ms)`。
  - `formatProgressPulse(label, elapsedMs)`。

## Step 3: TUI ticker

- 修改 `src/tui/streaming-tui.ts`：
  - 新增 `startProgress(label, intervalMs?)`。
  - 新增 `stopProgress()`。
  - `stop()` 中确保停止 ticker。
  - ticker 使用 `setInterval` 和 `unref()`。

## Step 4: REPL 接入

- 修改 `src/tui/streaming-repl.ts`：
  - `agent.run()` 前启动 `agent` 进度。
  - 成功、失败、循环进入下一轮前都停止。

## Step 5: 验证

- `npm run build`
- `node --test "tests/unit/tui-progress.test.mjs" "tests/smoke/chat-exit.smoke.test.mjs"`
- `npm run ci:check`
