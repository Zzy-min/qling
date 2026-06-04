# 顶层 CLI 命令错拼建议

## Summary
- 新增顶层 CLI 高置信命令错拼建议，避免 `qling expors`、`qling 导出列` 这类明显管理命令错拼被当成一次性任务发送给模型。
- 建议只基于本地静态命令/中文别名表计算，不读取运行时状态、不联网、不调用模型。
- 普通位置参数任务继续兼容：弱匹配或多词自然语言任务仍按现有 one-shot run 行为处理。

## User Journey
- 作为 CLI 用户，我输入 `qling expors` 时，希望立即得到 `/exports` 对应的顶层命令建议，而不是误触发模型执行。
- 作为中文用户，我输入 `qling 导出列` 时，希望看到 `导出列表` 建议和 `qling help 导出列表` 提示。
- 作为兼容用户，我输入 `qling 修复 bug` 或其他弱匹配自然语言任务时，仍希望走现有一次性任务兼容路径。

## Requirements
- 对首个位置参数做高置信命令候选判断，候选来源为已注册顶层命令与中文别名。
- 只有单个位置参数、没有显式 mode、没有 `--once`、没有 `--continue/--resume` 且候选分数达到阈值时，返回本地解析错误并提示建议。
- 错拼建议错误码固定为 `CLI_UNKNOWN_COMMAND_SUGGESTION`，退出码为 `2`。
- 错误消息必须包含：
  - 原始输入；
  - `你是不是想用`；
  - 推荐命令；
  - 对应 `qling help <topic>` 提示；
  - `qling run "<task>"` 兼容逃生口。
- 中文别名建议必须保留中文命令展示，例如 `qling 导出列表`。
- 弱匹配和多词任务不得拦截，继续走现有位置参数 one-shot 兼容行为。

## Non-Goals
- 不做正文检索、运行时状态读取、联网查询或模型纠错。
- 不引入交互式确认。
- 不移除现有 `qling "task"` 兼容路径。

## Acceptance
- `parseCliArgs(["expors"])` 返回 `CLI_UNKNOWN_COMMAND_SUGGESTION`，消息建议 `qling exports` 和 `qling help exports`。
- `parseCliArgs(["导出列"])` 返回 `CLI_UNKNOWN_COMMAND_SUGGESTION`，消息建议 `qling 导出列表` 和 `qling help 导出列表`。
- `parseCliArgs(["修复", "bug"])` 仍返回 `run`。
- `parseCliArgs(["zzzzzz"])` 仍返回 `run`，不误判。
- smoke 验证 `node dist/index.js expors` 退出码为 `2`，不泄露环境密钥、不初始化 AgentLoop。
