# Provider Token 官方计数与移除预算计划

## 步骤

1. 新增 `src/token-usage.ts`：`extractProviderUsage` / `ChatUsage` / 来源类型。
2. `agent-loop.ts`：移除 TokenBudget 与 nudge；chat 后仅累加官方 usage；扩展 session stats。
3. `memory.ts`：删除 `TokenBudgetManager`。
4. `pipeline/sections.ts`：删除 TOKEN_BUDGET section 与 builder。
5. `types.ts` / `config.ts` / `index.ts` / `config-report` / `tools/subtask` / `durable-session-supervisor`：去掉 budget 配置接线。
6. `context-report.ts` / `statusline.ts` / `/usage`：按官方用量展示，无预算百分比。
7. 更新单元测试与 README/CHANGELOG；`npm test`；commit + push。

## 风险

- 部分 provider 不返回 usage 时 tokens 显示 0/unknown——符合「不伪造账单」；文档说明。
- 旧配置文件中的 `max_token_budget` 静默忽略。
