# 本地蒸馏实践浏览 `/memory practices`

## Summary
- 在现有 `/memory` 本地浏览与搜索基础上，新增只读蒸馏实践浏览能力。
- 数据源仅限 `<stateDir>/memory/cognitive_knowledge.db` 的 `distilled_practices` 表。
- 命令不读取 session 正文、不调用模型、不联网、不写入或重建索引。

## Public Interface
- `/memory practices [count]`
- `/memory practice [count]`
- `/记忆 实践 [count]`
- `/记忆 经验 [count]`
- `qling memory practices [count]`
- `qling memory practice [count]`
- `qling 记忆 实践 [count]`
- `qling 记忆 经验 [count]`

## Behavior
- 默认显示最近/最高置信度 10 条，最多 50 条。
- 缺失 `cognitive_knowledge.db` 或 `distilled_practices` 表时正常退出，提示暂无本地蒸馏实践。
- 排序：`confidence` 倒序，`hit_count` 倒序，`created_at` 倒序，最后 `id` 升序。
- 输出字段固定为：ID、任务模式、置信度、命中次数、创建时间、动作预览、文件/上下文预览。
- JSON 字段解析失败时不抛出，降级为原始字符串预览并输出 warning。

## Privacy And Safety
- 不读取 `<stateDir>/sessions`，不输出 session messages。
- 不读取 embeddings 向量内容，不执行相似度检索。
- 不写入 DB，不删除、不回滚、不重建索引。
- 输出为审计摘要，不做导出、上传或跨文件全文搜索。

## Acceptance
- 单元测试覆盖缺失 DB、缺失表、排序/count、JSON 降级、session 正文不泄露。
- Slash 测试覆盖 `/memory practices` 与 `/记忆 经验`。
- CLI parser/help 测试覆盖英文与中文别名。
- Smoke 测试覆盖顶层 `memory practices`，确认命令可退出且不读取 session 正文。
- `npm run ci:check` 通过。
