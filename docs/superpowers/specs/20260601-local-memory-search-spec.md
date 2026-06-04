# 本地记忆搜索 `/memory search`

## Summary
- 在现有本地记忆浏览基础上新增只读搜索：slash `/memory search <query> [count]`、中文 `/记忆 搜索 <query> [count]`，以及顶层 `qingling memory search <query> [count]`。
- 搜索仅扫描 `<stateDir>/memory/memory.json` 中的 persisted memory 条目，不读取 session 正文、不调用模型、不联网。
- 每条命中输出可解释召回标签，说明匹配路径来自 `content`、`source` 或 `id`。

## Public Interface
- `/memory search <query> [count]`
- `/记忆 搜索 <query> [count]`
- `qingling memory search <query> [count]`
- `qingling 记忆 搜索 <query> [count]`

## Behavior
- `query` 为空时不执行搜索，输出用法错误。
- `count` 缺省、非法、小于等于 0 时为 10，最大 50。
- 查询匹配大小写不敏感。
- 支持短语匹配和 token 匹配：
  - 完整 query 出现在 content 中，标签为 `content:phrase`。
  - query token 出现在 content 中，标签为 `content:<token>`。
  - query token 出现在 source 中，标签为 `source:<token>`。
  - query token 出现在 id 中，标签为 `id:<token>`。
- 排序：匹配分数倒序，`importance` 倒序，`createdAt` 倒序，最后按 id 升序。
- 输出字段包括 ID、source、createdAt、importance、matched via、preview。
- 无命中时正常退出并提示无本地匹配。

## Privacy And Safety
- 不读取 `<stateDir>/sessions`，不输出 session messages。
- 不读取 `cognitive_knowledge.db` 内容，不调用 embedding 或 LLM。
- 不写入、不删除、不重建索引。
- 搜索结果只来自本地 `memory.json` 条目；输出 preview，不展示完整内容。完整审计仍通过 `memory show <id>`。

## Acceptance
- 单元测试覆盖排序、count 截断、匹配标签、无命中、空 query、session 正文不泄露。
- Slash 测试覆盖 `/memory search` 与 `/记忆 搜索`。
- CLI parser/help 测试覆盖 `memory search` 与中文别名。
- Smoke 测试覆盖顶层 `memory search`，确认可退出且不读取 session 正文。
- `npm run ci:check` 通过。
