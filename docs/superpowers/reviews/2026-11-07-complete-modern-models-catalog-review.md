# 全量模型提供商最新模型目录与选择器恢复复盘 (Review)

日期：2026-11-07
规格文档：`docs/superpowers/specs/2026-11-07-complete-modern-models-catalog-design.md`
实施计划：`docs/superpowers/plans/2026-11-07-complete-modern-models-catalog-plan.md`

## 1. 问题根因
用户反馈“你又把最新模型删了”。
排查确认：
在 `src/providers/presets.ts` 中，虽然 `MODEL_PROVIDER_AFFINITY` 中登记了各大提供商的最新模型（如 Qwen 3.8/3.7 系列、Claude 5.x 系列、Gemini 4/3.8 系列、GLM 5.x 系列、Kimi k3.x 系列等），但在获取已知模型 `knownModelsForProvider(provider)` 时，原有实现仅查验了仅有 20 余个老模型的 `KNOWN_MODEL_WINDOWS`，未将 `MODEL_PROVIDER_AFFINITY` 汇入候选池。
这导致 `listProviderModelEntries` 和 TUI 模型选择器 `buildGroupedModelPickerSpec` 过滤后丢失了绝大部分最新模型，使用户在界面上无法浏览和选择最新模型。

## 2. 修复内容
1. **数据源聚合与已知模型恢复 (`src/providers/presets.ts`)**：
   - 彻底修复 `knownModelsForProvider`，合并 `MODEL_PROVIDER_AFFINITY` 和 `KNOWN_MODEL_WINDOWS`：
     ```ts
     export function knownModelsForProvider(provider: string): string[] {
       const presets = presetsForProvider(provider);
       if (presets.length === 0) return [];
       const candidateKeys = new Set([
         ...Object.keys(MODEL_PROVIDER_AFFINITY),
         ...Object.keys(KNOWN_MODEL_WINDOWS),
       ]);
       return Array.from(candidateKeys).filter((name) => modelBelongsToPresets(name, presets));
     }
     ```
2. **主流厂商最新模型目录补齐**：
   - **阿里云百炼 (DashScope)**：`qwen3.8-max`, `qwen3.7-max`, `qwen3.8-plus`, `qwen3.7-plus`, `qwen3.6-plus`, `qwen3.5-plus`, `qwen3.8-flash`, `qwen3.7-flash`, `qwen3-coder-plus`, `qwen3-coder-flash`, `qwen-max`, `qwen-plus` 等 13 款模型。
   - **Anthropic**：`claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`, `claude-fable-5-1`, `claude-3-7-sonnet-latest`, `claude-3-5-sonnet-latest`, `claude-3-5-haiku-latest` 等 8 款模型。
   - **Google Gemini**：`gemini-4-argon`, `gemini-3.8-flash`, `gemini-3.5-pro`, `gemini-3.5-flash`, `gemini-3.1-pro`, `gemini-3.1-flash-lite`, `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.0-flash` 等 9 款模型。
   - **智谱清言 (GLM)**：`glm-5.3`, `glm-5.3-flash`, `glm-5.2`, `glm-4.7`, `glm-4.7-flash`, `glm-4` 等 6 款模型。
   - **月之暗面 (Moonshot Kimi)**：`kimi-k3.1-pro`, `kimi-k3`, `kimi-k2.7-code`, `kimi-k2.6`, `moonshot-v1-8k`, `moonshot-v1-32k`, `moonshot-v1-128k` 等 7 款模型。
   - **OpenAI**：`gpt-6-astra`, `gpt-6.1-sol`, `o4-mini`, `o3`, `o3-mini`, `o1`, `o1-mini`, `gpt-oss-120b`, `gpt-oss-20b`, `gpt-4o`, `gpt-4o-mini` 等 11 款模型。
   - **Mistral AI**：`deepseek-v4-1-flash-1017`, `codestral-latest`, `codestral-2508`, `mistral-large-latest`, `mistral-small-latest`, `ministral-8b-latest`, `ministral-14b-latest`, `ministral-3b-latest`, `mistral-vibe-cli-latest`, `mistral-vibe-cli-fast`, `zai-glm-5-3`, `zai-glm-5-3-flash` 等 13 款模型。
   - **DeepSeek**：`deepseek-flash`, `deepseek-v4-pro`, `deepseek-v4-flash`。
3. **上下文窗口元数据 (`KNOWN_MODEL_WINDOWS`) 补充**：
   - 补充各厂商主流新模型的 contextWindow 与 maxOutputTokens（例如 1M / 2M 窗口与 131k 输出）。
4. **测试适配**：
   - 更新并验证 `tests/unit/provider-model-filter.test.mjs` 和 `tests/unit/model-presets-refresh.test.mjs`。

## 3. 验证证据
- 模型列表及选择器专项测试（44 项）：全部 PASS（`44 pass, 0 fail`）。
- 全厂商模型输出验证：各主流服务商均可完整输出其全套最新模型。
