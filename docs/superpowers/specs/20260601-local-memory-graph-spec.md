# 本地知识图谱索引 `/memory graph`

## Summary

新增只读命令 `/memory graph [count]` 与中文别名 `/记忆 图谱 [count]`，用于查看本机认知索引中的知识图谱节点概览，补齐 M3 “Memory -> Knowledge”的本地可见性。

## Goals

- 从 `<stateDir>/memory/cognitive_knowledge.db` 读取 `kg_nodes` 与 `kg_edges` 的元数据。
- 默认显示最近 10 个节点，最多 50 个节点。
- 按 `last_seen` 倒序，其次按节点连接度倒序，再按 `id` 升序。
- 输出节点 ID、类型、标签、最后出现时间、连接度、关系预览。
- 不读取会话正文，不读取 `memory.json` 正文，不联网，不调用模型，不写入数据库。

## Non-Goals

- 不做图谱编辑、删除、打开文件、上传或重新索引。
- 不做正文检索或语义召回。
- 不展示 `kg_nodes.metadata`，避免泄露未来可能写入的敏感上下文。
- 不改变现有 `CognitiveIndex` 写入 schema。

## Public Interfaces

- Slash:
  - `/memory graph [count]`
  - `/memory 图谱 [count]`
  - `/记忆 graph [count]`
  - `/记忆 图谱 [count]`
- Top-level CLI:
  - `qingling memory graph [count]`
  - `qingling 记忆 图谱 [count]`

## Count Rules

- 缺省、非法值、小于等于 0：使用 `10`。
- 超过 `50`：截断为 `50`。
- 复用现有 `parseMemoryReportCount`。

## Output Fields

- DB 路径
- Nodes 显示数量/总数
- Edges 总数
- 节点 ID
- 类型
- 标签
- 最后出现时间
- 连接度
- 关系预览

## Empty And Error States

- DB 不存在：显示暂无本地知识图谱。
- `kg_nodes` 或 `kg_edges` 表不存在：显示暂无本地知识图谱，不报错。
- DB 不可读：输出 warning 并降级为空结果。
- 关系目标节点缺失时仍展示边 ID，不抛错。

## Privacy Boundary

命令只读取：

- `kg_nodes.id`
- `kg_nodes.type`
- `kg_nodes.label`
- `kg_nodes.last_seen`
- `kg_edges.source`
- `kg_edges.target`
- `kg_edges.relation`
- `kg_edges.weight`

命令不读取：

- `kg_nodes.metadata`
- `embeddings.content`
- `memory.json` entry content
- `sessions/*.json`

## Acceptance Criteria

- `/help` 展示 `/memory graph [count]`。
- `/memory graph` 能列出临时 stateDir 中的图谱节点。
- `/记忆 图谱` 与英文命令行为一致。
- 缺失 DB、缺失表时输出空态。
- 测试证明 session 正文不会出现在输出中。
- `npm run build`、目标单测、startup smoke、`npm run ci:check` 通过。
