# `qingling` TUI 长任务进度反馈规格（2026-05-31）

## 背景

轻灵已具备流式输出、状态线、多行输入和历史检索，但当 Agent 长时间运行且没有新工具事件时，用户只能等待最终结果，缺少“还活着、运行多久、当前阶段是什么”的反馈。目标是补齐 Claude Code 类长任务的低噪声进度感，同时保持本地稳定。

## 目标

- 在 TUI 中为长任务增加本地进度 ticker。
- Agent 开始运行后启动 ticker，周期性追加 `仍在运行` 与 elapsed 信息。
- Agent 完成、失败或 REPL 关闭时停止 ticker，避免遗留 timer。
- 进度只来自本地时间与本地阶段名，不上传、不持久化、不读取外部数据。
- 默认低频输出，避免刷屏。

## 非目标

- 不预测模型剩余时间。
- 不引入全屏重绘或动态进度条。
- 不改变 AgentLoop、mission 或 daemon 状态模型。
- 不把进度事件写入长期记忆。

## 行为

- `startProgress(label)` 启动一个本地 ticker。
- `stopProgress()` 停止当前 ticker。
- 重复启动会先停止旧 ticker，保证单实例。
- ticker 文案包含阶段标签和 elapsed，例如 `… agent 仍在运行 12.0s`。
- timer 使用 `unref()`，不阻塞进程退出。

## 验收

- 单测覆盖进度文案和 elapsed 格式。
- `StreamingREPL.processPrompt()` 在 `agent.run()` 前启动、结束/失败时停止。
- `StreamUI.stop()` 清理 ticker。
- `npm run build`、相关单测和 `npm run ci:check` 通过。
