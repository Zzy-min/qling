# `qingling` TUI 输入串行队列规格（2026-06-01）

## 背景

TUI 目标是“Agent 执行期间输入栏保持可用”。当前 `StreamUI` 在 `Enter` 后直接触发 async input callback，显示层不会等待 callback 完成；如果用户在模型或工具执行期间继续提交输入，多个 `handleUserInput()` 可能同时进入同一个 `AgentLoop.run()`，导致消息、工具事件、checkpoint、goal/loop 状态交错。

## 目标

- 保持执行期间可以继续提交输入，但所有输入必须按提交顺序串行处理。
- 同一时间最多一个用户输入或 slash command 进入 `AgentLoop`/slash command 处理链。
- 后续输入进入本地内存队列，不写磁盘、不联网、不调用模型。
- 队列处理单项失败时记录错误并继续处理后续输入，避免队列卡死。
- 队列长度可观测，便于后续状态线或提示扩展。
- 保持现有 `/goal` 自动续跑、`/loop` due task、`/statusline` 刷新和本地输入历史行为。

## 非目标

- 不实现跨进程持久任务队列。
- 不改变 AgentLoop 内部并发模型。
- 不新增用户可编辑队列命令。
- 不改变 `Enter`、`Ctrl+N`、`Ctrl+R` 的快捷键语义。

## 行为

- 第一条输入立即开始处理。
- 若处理期间又提交输入，新输入只入队，等待当前输入完全完成后再处理。
- 串行范围包含 slash command、普通 prompt、immediate prompt、goal auto-continue 和最终 statusline/prompt 刷新。
- 退出命令 `exit/q/quit` 按顺序生效；已排在它之前的输入先处理。
- 队列处理使用本进程内存，不保存用户正文到新文件。

## 验收

- 单测证明快速 `enqueue()` 多条异步任务时没有并发重入，完成顺序等于提交顺序。
- 单测证明单项失败后队列继续处理下一项，且错误可被回调捕获。
- `StreamingREPL` 通过队列处理 `handleUserInput()`，避免直接并发进入 `processPrompt()`。
- `npm run build`、目标单测和 `npm run ci:check` 通过。
