# 全量模型提供商最新模型目录与选择器恢复设计 (Spec)

日期：2026-11-07
状态：已批准（Approved）

## 1. 目标与背景
用户反馈“你又把最新模型删了”。
经深度排查，发现根本原因如下：
在 `src/providers/presets.ts` 中，虽然 `MODEL_PROVIDER_AFFINITY` 字典中登记了大量各大提供商的最新模型（例如 Qwen 3.8/3.7系列、Claude 5.x系列、Gemini 4/3.8系列、GLM 5.x系列、Kimi k3.x系列等），但是：
1. `knownModelsForProvider(provider)` 内部只遍历了 `KNOWN_MODEL_WINDOWS`，而 `KNOWN_MODEL_WINDOWS` 仅包含 13 个老模型，导致 `listProviderModelEntries` 和模型选择器 `buildGroupedModelPickerSpec` 根本无法将 `MODEL_PROVIDER_AFFINITY` 中的最新模型暴露给用户！
2. 用户在 TUI 选择器或运行 `/model list` 时，每个提供商下只看到 1 个 preset 模型或极少数老模型，所有最新查出来的模型在界面上全部隐形，产生“最新模型被删了”的严重体验问题。
3. 部分最新模型未补齐（例如 Moonshot 的 `kimi-k3.1-pro`，DeepSeek 的 `deepseek-reasoner` 等），且各主流模型的上下文窗口在 `KNOWN_MODEL_WINDOWS` 中缺失。

## 2. 详细设计

### 2.1 修复 `knownModelsForProvider` 数据源聚合
修改 `knownModelsForProvider`，将候选池扩大为 `MODEL_PROVIDER_AFFINITY` 与 `KNOWN_MODEL_WINDOWS` 的合集：
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

### 2.2 完善各提供商最新现役模型清单
- **DeepSeek**: `deepseek-flash`, `deepseek-v4-pro`, `deepseek-v4-flash`, `deepseek-chat`, `deepseek-reasoner`
- **阿里云百炼 (DashScope)**: `qwen3.8-max`, `qwen3.7-max`, `qwen3.8-plus`, `qwen3.7-plus`, `qwen3.6-plus`, `qwen3.5-plus`, `qwen3.8-flash`, `qwen3.7-flash`, `qwen3-coder-plus`, `qwen3-coder-flash`, `qwen-max`, `qwen-plus`
- **智谱清言 (Zhipu)**: `glm-5.3`, `glm-5.3-flash`, `glm-5.2`, `glm-5.1`, `glm-5`, `glm-5-turbo`, `glm-4.7`, `glm-4.7-flash`, `glm-4`
- **月之暗面 (Moonshot)**: `kimi-k3.1-pro`, `kimi-k3`, `kimi-k2.7-code`, `kimi-k2.6`, `moonshot-v1-8k`, `moonshot-v1-32k`, `moonshot-v1-128k`
- **Anthropic**: `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`, `claude-fable-5-1`, `claude-3-7-sonnet-latest`, `claude-3-5-sonnet-latest`, `claude-3-5-haiku-latest`
- **Google Gemini**: `gemini-4-argon`, `gemini-3.8-flash`, `gemini-3.5-pro`, `gemini-3.5-flash`, `gemini-3.1-pro`, `gemini-3.1-flash-lite`, `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.0-flash`
- **OpenAI**: `gpt-6-astra`, `gpt-6.1-sol`, `o4-mini`, `o3`, `o3-mini`, `o1`, `o1-mini`, `gpt-4o`, `gpt-4o-mini`, `gpt-oss-120b`, `gpt-oss-20b`
- **Mistral**: `deepseek-v4-1-flash-1017`, `codestral-latest`, `codestral-2508`, `mistral-large-latest`, `mistral-small-latest`, `ministral-8b-latest`, `ministral-14b-latest`, `ministral-3b-latest`, `mistral-vibe-cli-latest`, `mistral-vibe-cli-fast`, `zai-glm-5-3`, `zai-glm-5-3-flash`
- **MiniMax**: `minimax-m3.1-flash`, `minimax-m3`, `minimax-m2.7`, `minimax-m2.7-highspeed`
- **Xiaomi MiMo**: `mimo-v2.6-pro`, `mimo-v2.6-flash`, `mimo-v2`
- **xAI**: `grok-4`, `grok-build`, `grok-2-latest`, `grok-2`, `grok-2-mini`
- **SiliconFlow**: `deepseek-ai/deepseek-v4.1-flash`, `deepseek-ai/deepseek-v3`, `deepseek-ai/deepseek-r1`, `qwen/qwen2.5-coder-32b-instruct`, `qwen/qwen2.5-72b-instruct`
- **OpenRouter**: `anthropic/claude-sonnet-5-5`, `anthropic/claude-3.7-sonnet`, `deepseek/deepseek-r1`, `deepseek/deepseek-chat`, `google/gemini-2.0-flash-001`
- **Ollama**: `deepseek-r1:latest`, `deepseek-r1:32b`, `deepseek-r1:14b`, `deepseek-r1:8b`, `qwen2.5-coder:32b`, `qwen2.5-coder:14b`, `llama3.3:latest`, `llama3`

### 2.3 补齐 `KNOWN_MODEL_WINDOWS`
为这些主流模型补齐 contextWindow 与 maxOutputTokens，使 TUI 选择器显示准确的 `1M ctx · 131k out` 等信息。

### 2.4 测试用例适配
更新 `tests/unit/provider-model-filter.test.mjs`，确保断言检查与最新全量模型目录一致。
