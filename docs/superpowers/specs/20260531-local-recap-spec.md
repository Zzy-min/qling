# `qling` 本地会话回顾规格（2026-05-31）

## 背景

轻灵已经支持会话恢复、状态线、goal、loop 和本地上下文报告。为了贴近 Claude Code 的回到会话体验，用户需要一个轻量 `/recap`，在不中断当前会话的情况下快速了解“最近发生了什么、当前目标和任务是什么、数据在哪里”。

## 目标

- 新增 `/recap` slash command，中文别名 `/回顾`。
- 输出当前 session 的本地摘要：session、turn、tokens、goal、active tasks、workspace。
- 输出最近若干条消息的角色和短摘录，默认 6 条，可通过数字参数调整。
- 只读取当前进程内本地消息快照、goal/task 状态和 workspace，不调用模型、不联网、不写远端。
- 摘录做单行化和长度限制，避免刷屏或泄露过多上下文。

## 非目标

- 不生成 LLM 总结。
- 不跨会话检索历史。
- 不写入 memory 或长期知识库。
- 不改变 session snapshot 格式。

## 行为

- `/recap` 默认显示最近 6 条消息。
- `/recap 3` 显示最近 3 条消息。
- 非法数量降级为默认值。
- 空消息时输出 `最近消息: 无`。
- 对象消息或 tool content 稳定降级为 JSON 短摘录。

## 验收

- 单测覆盖 formatter 的默认摘要、数量限制、空消息降级。
- slash 单测覆盖 `/recap` 和 `/回顾`。
- `/help` 列出 `/recap`。
- `npm run build`、相关单测和 `npm run ci:check` 通过。
