# 本地记忆浏览 `/memory`

## Summary
- 新增只读本地记忆浏览能力：slash `/memory`、中文 `/记忆`，以及顶层 `qling memory status|list|show` 与中文 `qling 记忆 ...`。
- 数据源仅限 `<stateDir>/memory/memory.json` 与本地认知索引数据库元数据。
- 不读取 session 正文、不联网、不调用模型、不重建索引。

## Public Interface
- `/memory [count]`
- `/memory show <id>`
- `/记忆 [count]`
- `/记忆 查看 <id>`
- `qling memory status [count]`
- `qling memory list [count]`
- `qling memory show <id>`
- `qling 记忆 [count]`
- `qling 记忆 查看 <id>`
- 兼容保留：`qling memory reindex [--full]`

## Behavior
- 默认展示最近 10 条 persisted memory，最多 50 条。
- `status` 与 `list` 等价，输出 memory 目录、文件路径、总数、来源分布、认知索引表计数、最近记忆摘要。
- 列表排序：先按 `createdAt` 倒序，再按 `importance` 倒序。
- 摘要每条最多 120 字符，包含 ID、source、importance、createdAt、content preview。
- `show <id>` 展示单条记忆详情，便于审计。
- 缺失 memory 目录或 memory.json 时正常退出，提示没有本地持久记忆。
- cognitive db 只读打开；不存在或无法读取时降级为 `unavailable`，不影响主输出。

## Privacy And Safety
- 不读取 `<stateDir>/sessions`，不输出 session messages。
- 不写入 memory.json，不删除、不回滚、不重建索引。
- 不调用 embedding、LLM、MCP 或网络。
- `memory reindex` 保持原行为，不纳入本地只读分支。

## Acceptance
- `/help` 展示 `/memory` 与 `/记忆`。
- `qling --help` 展示 `memory status|list|show` 与中文别名。
- 单元测试覆盖缺失目录、排序/count、show、认知索引元数据、session 正文不泄露。
- Slash 测试覆盖 `/memory` 和 `/记忆 查看 <id>`。
- Smoke 测试覆盖顶层 `memory status` 与中文 `记忆 查看 <id>`。
- `npm run ci:check` 通过。
