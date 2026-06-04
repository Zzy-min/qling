# `qingling` 本地会话导出规格（2026-05-31）

## 背景

目标强调“数据留存本地”。当前轻灵有 `/context`、`/privacy` 和 session snapshot，但用户还缺少一个显式动作，把当前会话导出成可读、可备份、可审计的本地文件。

## 目标

- 新增 `/export` slash command，中文别名 `/导出`。
- 将当前会话导出为 Markdown 文件。
- 默认写入 `<stateDir>/exports/`，使用唯一文件名。
- 导出内容包含 session stats、workspace、导出时间、消息角色和正文。
- 命令输出生成文件绝对路径。
- 只读取当前本地会话快照，不调用模型、不联网。

## 非目标

- 不实现云端同步。
- 不导出为 PDF/DOCX。
- 不写入 memory 或知识库。
- 不允许覆盖已有文件。
- 不改变 session snapshot 格式。

## 行为

- `/export` 导出当前会话 Markdown 到默认 exports 目录。
- `/导出` 与 `/export` 等价。
- 即使没有消息，也生成带元数据和空消息提示的文件。
- 目录不存在时自动创建。
- 文件名包含 session id 和时间戳，避免覆盖。

## 验收

- 单测覆盖 Markdown formatter 的元数据、消息正文和空消息降级。
- 单测覆盖导出写入本地文件。
- slash 单测覆盖 `/export` 与 `/导出`。
- `/help` 列出 `/export`。
- `npm run build`、相关单测和 `npm run ci:check` 通过。
