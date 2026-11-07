# 全模型提供商目录全面更新与现代化实施计划 (Implementation Plan)

## 1. 计划目标
全面更新轻灵中全部模型提供商（Provider）的最新现役模型，纠正过时与误标下线的模型，增加 `openrouter`、`anthropic`、`gemini` 预设，确保分组模型选择器 `/model` 中各板块具备最新、最完整的模型清单。

## 2. 执行步骤

### 阶段 1：数据梳理与上下文窗口扩充 (`src/providers/presets.ts`)
- [ ] 1. 修正 `RETIRED_MODELS`：
  - 移出 `deepseek-chat`、`deepseek-reasoner`、`moonshot-v1-8k/32k/128k`。
- [ ] 2. 更新 `KNOWN_MODEL_WINDOWS`，补充各提供商主流现役模型：
  - **DeepSeek**: `deepseek-chat` (128k/8k), `deepseek-reasoner` (128k/8k), `deepseek-coder` (128k/8k)。
  - **OpenAI**: `gpt-4o` (128k/16k), `gpt-4o-mini` (128k/16k), `o1` (200k/100k), `o1-mini` (128k/65k), `o3-mini` (200k/100k), `gpt-4-turbo` (128k/4k), `chatgpt-4o-latest` (128k/16k)。
  - **Anthropic**: `claude-3-7-sonnet-latest` (200k/64k), `claude-3-5-sonnet-latest` (200k/8k), `claude-3-5-haiku-latest` (200k/8k), `claude-3-opus-latest` (200k/4k)。
  - **Google Gemini**: `gemini-2.5-pro` (1000k/64k), `gemini-2.5-flash` (1000k/64k), `gemini-2.0-flash` (1000k/8k), `gemini-1.5-pro` (2000k/8k), `gemini-1.5-flash` (1000k/8k)。
  - **DashScope (阿里云百炼)**: `qwen-max` (32k/8k), `qwen-plus` (128k/8k), `qwen-turbo` (128k/8k), `qwen-long` (1000k/8k), `qwen2.5-coder-32b-instruct` (128k/8k), `qwen2.5-72b-instruct` (128k/8k), `qwq-32b-preview` (32k/8k)。
  - **Zhipu (智谱)**: `glm-4-plus` (128k/8k), `glm-4-air` (128k/8k), `glm-4-flash` (128k/8k), `glm-4-long` (1000k/8k), `glm-zero-preview` (128k/8k), `codegeex-4` (128k/8k)。
  - **Moonshot (Kimi)**: `kimi-latest` (256k/8k), `moonshot-v1-8k` (8k/8k), `moonshot-v1-32k` (32k/8k), `moonshot-v1-128k` (128k/8k), `moonshot-v1-auto` (128k/8k)。
  - **MiniMax**: `MiniMax-Text-01` (4000k/8k), `abab6.5s-chat` (245k/8k), `abab6.5t-chat` (245k/8k), `abab6.5g-chat` (245k/8k)。
  - **SiliconFlow**: `deepseek-ai/DeepSeek-V3` (64k/8k), `deepseek-ai/DeepSeek-R1` (64k/8k), `Qwen/Qwen2.5-Coder-32B-Instruct` (32k/8k), `meta-llama/Meta-Llama-3.1-405B-Instruct` (128k/8k), `meta-llama/Meta-Llama-3.1-70B-Instruct` (128k/8k)。
  - **xAI**: `grok-2-latest` (128k/8k), `grok-2` (128k/8k), `grok-2-mini` (128k/8k), `grok-beta` (128k/8k)。
  - **Ollama**: `deepseek-r1:latest` (64k/8k), `deepseek-r1:8b` (64k/8k), `deepseek-r1:14b` (64k/8k), `deepseek-r1:32b` (64k/8k), `qwen2.5-coder:latest` (32k/8k), `qwen2.5-coder:7b` (32k/8k), `qwen2.5-coder:14b` (32k/8k), `qwen2.5-coder:32b` (32k/8k), `qwen2.5:latest` (32k/8k), `llama3.3:latest` (128k/8k), `llama3.1:8b` (128k/8k)。
  - **OpenRouter**: `anthropic/claude-3.7-sonnet` (200k/64k), `anthropic/claude-3.5-sonnet` (200k/8k), `deepseek/deepseek-r1` (128k/8k), `deepseek/deepseek-chat` (128k/8k), `google/gemini-2.0-flash-001` (1000k/8k), `meta-llama/llama-3.3-70b-instruct` (128k/8k), `qwen/qwen-2.5-coder-32b-instruct` (128k/8k)。

### 阶段 2：预设映射与亲和力关联 (`src/providers/presets.ts`)
- [ ] 1. 在 `PRESET_MAP` 中完善提供商，新增 `openrouter`、`anthropic`、`gemini`。
- [ ] 2. 修正 `openai` 的默认 model 为 `gpt-4o`。
- [ ] 3. 更新 `PROVIDER_PRESET_ORDER` 和 `ALIASES`。
- [ ] 4. 更新 `MODEL_PROVIDER_AFFINITY`，确保所有已知模型能够精确归入所属的 Provider 板块。

### 阶段 3：环境变量与鉴权支持 (`src/providers/resolve-llm.ts`)
- [ ] 1. 在 `PROVIDER_API_KEY_ENV` 中添加 `openrouter: "OPENROUTER_API_KEY"`, `anthropic: "ANTHROPIC_API_KEY"`, `gemini: "GEMINI_API_KEY"`。

### 阶段 4：编译与验证
- [ ] 1. 运行 `npm run build`，确保 TypeScript 编译通过。
- [ ] 2. 运行所有单元测试，更新现有单测以适配新增提供商与模型目录。
- [ ] 3. 运行 `qling doctor` 和 `/model` 分组逻辑测试。
- [ ] 4. 撰写 Review 总结。
