# TUI 队列命令宽容解析规格（2026-06-01）

## 背景

TUI 已支持 `/queue`、`/queue clear`、`/队列`、`/队列 清空` 作为即时命令。长任务运行时，用户可能输入多余空格或更自然的中文简写；这些输入不应被误当成普通 prompt 入队。

## 目标

- 队列即时命令解析应忽略首尾空白和连续空白。
- `/queue   clear`、`/queue   status` 与标准写法等价。
- `/清空队列` 作为中文快捷写法等价于 `/队列 清空`。
- 未识别的 `/queue ...` 不进入 AgentLoop 普通 prompt，应该给出本地用法提示。
- 输出只包含队列元数据或用法提示，不包含用户 pending 输入正文。

## 非目标

- 不实现 running 任务取消。
- 不新增持久化、联网或模型调用。
- 不改变普通非队列命令的 slash 处理。

## 验收

- 单测覆盖多空格英文 clear/status。
- 单测覆盖 `/清空队列` 中文简写。
- 单测覆盖未知 `/queue later` 不进入 `processPrompt()`。
- TUI smoke 和 `npm run ci:check` 通过。
