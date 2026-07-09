# Provider Token 官方计数与移除预算规格

## 背景

会话 token 计数存在本地启发式（字符×4）与 Token Budget 双轨逻辑：预算 nudge、system prompt 预算节、max_token_budget 百分比水位。这与「按各模型官方 usage 记账」不一致，且预算会干扰任务完成策略。

## 目标

1. **Token 计数仅采用模型/提供商官方返回的 usage**（或等价官方字段）。
2. **删除预算功能**：不再有 max token budget、预算 nudge、TOKEN_BUDGET system section、预算百分比水位。
3. `/usage`、`/context`、statusline 展示官方用量与来源，不展示预算占比。

## 行为

### 官方 usage 解析（优先级）

支持 OpenAI 兼容与常见变体：

| 来源 | 字段 |
|------|------|
| OpenAI / DeepSeek / 多数兼容 | `prompt_tokens`, `completion_tokens`, `total_tokens` |
| 驼峰变体 | `promptTokens`, `completionTokens`, `totalTokens` |
| Anthropic 风格 | `input_tokens`, `output_tokens` |
| Ollama 风格 | `prompt_eval_count`, `eval_count` |

规则：

- `total` 优先；缺失时用 prompt + completion。
- 仅当解析到正数 total 时，`tokenSource = "provider"` 并累加到会话。
- **不再**用字符×4 作为会话 token 来源；缺失 usage 时本轮记 0，`tokenSource` 保持或降为 `unknown`（若会话从未拿到 provider usage）。

### 删除的预算行为

- `TokenBudgetManager` 与 `tokenBudget` / `maxTokenBudget` / `max_token_budget` 配置接线
- 回合开始时的预算 nudge 用户消息
- system prompt `TOKEN_BUDGET` section
- context/statusline/usage 中的 budget 百分比与 max 分母

### 保留

- ContextCompactor 内部消息体量启发式（用于触发压缩，非会话账单）
- API 请求参数 `max_tokens`（生成上限，非会话预算）
- 可选 `QLING_STATUSLINE_COST_PER_1K_TOKENS` 成本估算（基于已累加 provider tokens）

## 非目标

- 不引入 tiktoken 等本地分词依赖作为会话权威计数
- 不改模型调用协议与工具执行语义
- 不强制迁移用户磁盘上的历史 `max_token_budget` 字段（忽略即可）
