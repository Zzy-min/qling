# 聚焦帮助主题规格（2026-06-01）

## 背景

轻灵已经补齐了大量本地只读命令，但 `/help` 和 `qling help` 仍是长列表。随着命令数量增加，用户想确认某个命令的用法、别名和边界时需要滚屏查找，交互不够接近 Claude Code CLI 的即时可发现体验。

## 目标

- 新增聚焦帮助能力：`/help <topic>`、`/? <topic>`、`qling help <topic>`、`qling 帮助 <topic>`。
- 主题支持英文主命令、slash 形式和中文别名，例如 `exports`、`/exports`、`导出列表`。
- 输出固定包含：主题、用法、别名、示例、边界说明。
- 未知主题不报错崩溃，输出可读提示并建议回到 `/help` 或 `qling help`。
- 只使用静态本地帮助表，不读取状态文件、不读取会话正文、不联网、不调用模型。

## 非目标

- 不实现交互式搜索 UI。
- 不从远端文档抓取帮助。
- 不自动执行帮助示例。
- 不重写已有命令行为。

## 行为

- `/help exports` 显示导出索引的聚焦帮助，包含 `/exports [count]`、`/导出列表 [count]` 和本地元数据边界。
- `/help permissions` 显示权限命令的聚焦帮助，包含 `/permissions explain <tool>` 与 `/权限 解释 <tool>`。
- `qling help exports` 显示 top-level 形态示例，例如 `qling exports 20`。
- `qling 帮助 权限` 与 `qling help permissions` 行为一致。
- 未知主题显示“未找到帮助主题”，并提示使用通用帮助。

## 验收

- 单测覆盖主题匹配、中文别名匹配、未知主题降级和 slash/top-level 输出差异。
- slash 测试覆盖 `/help exports`、`/? 权限`。
- CLI parser 测试覆盖 `qling help exports` 与 `qling 帮助 权限` 保留 subArgs。
- smoke 测试覆盖 top-level 聚焦帮助可退出且不泄露环境密钥。
- `npm run build`、目标测试和 `npm run ci:check` 通过。
