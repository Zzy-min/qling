# 聚焦帮助主题错拼建议

## Summary
- 为 `qingling help <topic>` 和 slash 聚焦帮助补充本地静态主题错拼建议。
- 目标是让 `qingling help expors`、`/help expors` 这类明显错拼直接指向 `exports`，保持 Claude Code 风格的顺滑纠错。
- 该能力只查询本地静态帮助表，不读取运行时状态、不调用模型、不联网。

## User Journey
- 作为 CLI 用户，我输入 `qingling help expors` 时，希望看到 `exports` 的建议和可直接复制的 `qingling help exports`。
- 作为 TUI 用户，我输入 `/help expors` 时，希望看到 `/exports` 或 `/help exports` 相关建议，而不是只看到“未找到帮助主题”。
- 作为普通任务用户，如果主题名和任何帮助主题差距很大，我不希望系统给出低置信误导建议。

## Requirements
- 聚焦帮助未知主题时，若高置信匹配到已知主题或别名，输出必须包含 `你是不是想看`。
- CLI surface 建议必须包含 `qingling help <topic-id>` 和该主题的 CLI usage。
- Slash surface 建议必须包含 `/help <topic-id>` 和该主题的 slash usage。
- 弱匹配未知主题必须保留现有 fallback：提示查看全部帮助，不展示“你是不是想看”。
- 主题建议必须复用现有帮助主题表，不新增远程依赖或模型调用。
- 现有精确主题输出、别名解析和本地边界说明保持不变。

## Non-Goals
- 不改变帮助命令退出码；未知主题仍是帮助输出，而不是启动错误。
- 不引入多候选菜单或交互选择。
- 不扩大帮助主题表的覆盖范围。

## Acceptance
- `formatFocusedHelp("expors", { surface: "cli", binName: "qingling" })` 输出建议 `qingling help exports` 和 `qingling exports [count]`。
- `formatFocusedHelp("导出列", { surface: "cli", binName: "qingling" })` 输出建议 `qingling help exports` 和 `qingling exports [count]`。
- `formatFocusedHelp("expors", { surface: "slash" })` 输出建议 `/help exports` 和 `/exports [count]`。
- `formatFocusedHelp("zzzzzz", { surface: "cli" })` 不输出“你是不是想看”。
- smoke 验证 `node dist/index.js help expors` 退出码为 `0`，不泄露环境密钥，不初始化 AgentLoop。
