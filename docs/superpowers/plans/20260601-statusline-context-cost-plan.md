# 状态线上下文占用与本地成本估算 Implementation Plan

## User Journey

作为轻灵用户，我希望每次查看状态线时都能快速知道当前上下文大概用了多少、是否接近预算，以及如果我本地配置了估算单价，大概已经产生多少成本。

## Implementation Steps

1. 扩展 `src/statusline.ts`：
   - `StatusLineSnapshot.maxTokens?: number | null`
   - `StatusLineSnapshot.costPer1kTokens?: number | null`
   - 新增 `parseStatusLineCostPer1k`
   - 新增 context/cost 格式化 helpers
2. `formatStatusLine`：
   - 保留既有字段，追加 `ctx=` 与 `cost=`/`cost≈`
   - 对缺失/非法 max token 与成本配置安全降级
3. `collectStatusLineSnapshot`：
   - 从 `agentLoop.getTokenBudget()?.maxTokens` 或 `agentLoop.tokenBudget.maxTokens` 读取 max token
   - 从 `process.env.QINGLING_STATUSLINE_COST_PER_1K_TOKENS` 读取估算单价
4. `collectLocalStatusLineSnapshot`：
   - 接收 `maxTokens` 与 `costPer1kTokens`
5. 顶层 CLI `src/index.ts`：
   - `qingling statusline` 传入 `loaded.config.runtime.max_token_budget`
   - 传入本地 env 成本估算
6. Slash command：
   - 使用 `buildStatusLine(context)` 的增强输出
   - 现有 `on/off/status` 行为不变
7. 测试：
   - `tests/unit/statusline.test.mjs`
   - `tests/unit/slash-commands.test.mjs`
   - `tests/smoke/cli-startup.smoke.test.mjs`

## TDD Plan

RED:

- formatter 输出 `ctx=12,345/120,000(10%)` 与 `cost≈$...`
- formatter 对缺失 max/cost 降级为 `ctx=.../-` 与 `cost=-`
- slash fallback `buildStatusLine` 从 agentLoop token budget 与 env 单价生成 context/cost
- top-level `状态线` smoke 显示 context/cost 且不泄露 secret/session body

GREEN:

- 实现最小格式化与采集逻辑。

REFACTOR:

- 保持状态线字段单行、短文本、无正文读取。
- 避免引入配置 schema 大改，先使用 env 作为本地估算入口。

## Verification Commands

```powershell
npm run build
node --test tests/unit/statusline.test.mjs tests/unit/slash-commands.test.mjs
node --test tests/smoke/cli-startup.smoke.test.mjs
npm run ci:check
```

## Risks

- 成本估算可能被误读为真实账单。输出使用 `cost≈` 并在 spec 中明确为本地估算。
- 当前 token 统计本身是估算值，因此 context/cost 都只能作为交互提示，不作为计费或限流依据。
