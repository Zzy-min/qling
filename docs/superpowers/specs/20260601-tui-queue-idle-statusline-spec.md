# TUI 队列空闲状态线恢复规格（2026-06-01）

## 背景

状态线已能显示 `queue=run/<max>` 和 `queue=<pending>/<max>`。但如果 prompt 在队列 handler 内部恢复，状态线刷新发生在 `SerialInputQueue.isProcessing === true` 的阶段，最后一次 prompt 可能显示已经过期的 `queue=run/<max>`。

## 目标

- prompt 恢复应由 `handleUserInput()` 在队列项完成后统一执行。
- 队列项处理函数只负责执行输入，不直接刷新状态线或恢复 prompt。
- 最后一条输入处理完成后，prompt 使用空闲状态线，不残留 `queue=run/<max>`。
- 退出命令关闭 UI 后不再恢复 prompt。
- 继续保持只显示队列元数据，不显示输入正文。

## 非目标

- 不改变队列串行执行顺序。
- 不改变 backpressure 上限。
- 不新增持久化或网络行为。

## 验收

- 单测覆盖普通输入处理完成后，prompt 恢复时状态线不含 `queue=`。
- 现有输入队列、状态线和 TUI smoke 测试通过。
- `npm run ci:check` 通过。
