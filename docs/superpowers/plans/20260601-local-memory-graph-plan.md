# 本地知识图谱索引 `/memory graph` Implementation Plan

## User Journey

作为轻灵用户，我想在不联网、不调用模型的情况下查看本地知识图谱索引，让我知道轻灵已经把哪些命令、文件、任务或技术节点关联起来。

## Implementation Steps

1. 在 `src/memory-report.ts` 新增知识图谱报告类型：
   - `LocalMemoryGraphNode`
   - `LocalMemoryGraphReport`
2. 新增 `listLocalMemoryGraph(stateDir, options)`：
   - 解析 `<stateDir>/memory/cognitive_knowledge.db`
   - 只读打开 SQLite
   - 检查 `kg_nodes`、`kg_edges` 是否存在
   - 读取节点基础字段与边基础字段
   - 计算每个节点的入度、出度、连接度与关系预览
   - 按 `last_seen DESC, degree DESC, id ASC` 排序并按 count 截断
3. 新增 `formatLocalMemoryGraphReport(report)`：
   - 输出 DB 路径、节点/边数量、limit、warning、节点列表
   - 空态提示继续使用轻灵后会自动沉淀图谱
   - 明确只读隐私边界
4. 接入 slash command：
   - `src/commands/memory.ts` 增加 `graph`、`图谱`、`知识图谱` alias
   - `/memory graph [count]` 与 `/记忆 图谱 [count]`
5. 接入 top-level CLI：
   - `src/index.ts` 的 `normalizeMemorySubcommand`
   - `decision.mode === "memory"` 分支
   - `src/cli/startup-contract.ts` help
6. 更新 slash help：
   - `src/commands/help.ts`
7. 测试：
   - `tests/unit/memory-report.test.mjs`
   - `tests/unit/slash-commands.test.mjs`
   - `tests/unit/cli-startup.test.mjs`
   - `tests/smoke/cli-startup.smoke.test.mjs`

## TDD Plan

RED:

- `memory graph lists kg nodes sorted by recency and degree without reading sessions`
- `memory graph handles missing db and missing kg tables without failing`
- Slash `/memory graph` lists local nodes and hides session body
- Slash `/记忆 图谱` aliases English behavior
- Top-level parser/help exposes `memory graph`
- Startup smoke `qling memory graph 5` exits 0 and hides session body

GREEN:

- Implement minimal report function and command wiring.

REFACTOR:

- Reuse `parseMemoryReportCount`, `exists`, `hasTable`, and `formatCreatedAt`.
- Keep SQLite reads narrow and explicit.

## Verification Commands

```powershell
npm run build
node --test tests/unit/memory-report.test.mjs tests/unit/slash-commands.test.mjs tests/unit/cli-startup.test.mjs
node --test tests/smoke/cli-startup.smoke.test.mjs
npm run ci:check
```

## Risks

- Existing or future DBs may have partial `kg_nodes/kg_edges` schemas. The implementation should treat missing required tables as empty and preserve warning-based degradation for unreadable DBs.
- Labels may contain user-relevant local identifiers. This command is explicitly local-only and does not upload or model-process labels.
