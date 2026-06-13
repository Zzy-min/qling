# Slash Skill 与实时补全 Implementation Plan

## 1. RED Tests

- 扩展 slash command 测试：`/skill`、`/skill list`、`/skill search docker`、`/skill docker` 使用临时 `skills/` 目录。
- 扩展 focused help 测试：`/help skill` 与 `/skill --help` 输出本地边界和示例。
- 新增 catalog 一致性测试：`COMMANDS` 中每个命令都可在 catalog 中发现。
- 扩展 TUI 测试：输入 `/sk` 显示 `/skill` 候选，`Tab` 补全为 `/skill `；空输入 `Tab` 仍提交 `/agents`。

## 2. Slash Catalog

- 新增纯 helper，导出 `getSlashCommandCatalog()`、`findSlashCompletion()`、`formatSlashCompletionHint()`。
- 复用现有 `COMMANDS` 与 alias 信息，保证纠错和补全来自同一数据源。
- `formatUnknownSlashCommandMessage()` 改用 catalog suggestion。

## 3. Skill Command

- `/skill` 不再使用 discovery registry。
- 复用 `runSkill()` 执行 list/search/load，并把 `ToolResult` 转为 slash 输出。
- 错误走 `context.writeError()`，成功走 `context.writeLine()`。

## 4. TUI Integration

- `StreamUI` 在输入框后渲染 slash 候选提示。
- 重绘时清除旧候选行，保持光标回到输入框内。
- `Tab` 在 slash 前缀有候选时补全最佳候选；其他行为保持。

## 5. Verification

- `npm run build && node --test tests\\unit\\slash-commands.test.mjs tests\\unit\\skill.test.mjs tests\\unit\\streaming-tui-ctrl-c.test.mjs tests\\unit\\help-topics.test.mjs`
- `npm run ci:check`
- 旧英文命名扫描、`git diff --check`、高危依赖审计。
