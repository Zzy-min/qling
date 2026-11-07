# 全模型提供商目录全面更新与现代化设计规范 (Model Providers Catalog Modernization)

## 1. 概述与背景
轻灵（Qling）预设体系（`src/providers/presets.ts`、`src/providers/resolve-llm.ts`）是整个命令行、`/model` 选择器、`qling setup`、`qling doctor` 和运行时认证解析的单一真相源（Single Source of Truth）。
目前代码库中很多提供商的模型定义存在滞后或断代：
1. **主要现役主力模型缺失**：
   - **DeepSeek**：`deepseek-chat` (V3) 与 `deepseek-reasoner` (R1) 曾被错放进 `RETIRED_MODELS`，而实际官方生产环境中这两个才是核心模型。
   - **OpenAI**：默认模型配置了未发布的虚构模型 `gpt-6-astra`，导致真实 OpenAI Key 用户遇到 404；缺失 `gpt-4o`（应为主力默认）、`o1`、`o1-mini`、`o3-mini`、`gpt-4-turbo`。
   - **阿里云百炼 (DashScope / Qwen)**：缺少实际生产主力 `qwen-max`、`qwen-turbo`、`qwen2.5-coder-32b-instruct`、`qwq-32b-preview`。
   - **智谱清言 (Zhipu / GLM)**：缺少广泛使用的 `glm-4-plus`、`glm-4-air`、`glm-4-flash`、`codegeex-4`。
   - **月之暗面 (Moonshot / Kimi)**：`moonshot-v1-*` 曾被标为下线，但官方 API 仍主要提供 `moonshot-v1-8k/32k/128k` 与 `kimi-latest`。
   - **硅基流动 (SiliconFlow)**：缺少 `deepseek-ai/DeepSeek-V3`、`deepseek-ai/DeepSeek-R1`、`Qwen/Qwen2.5-Coder-32B-Instruct` 等顶级开源托管模型。
   - **xAI (Grok)**：缺少现役生产 `grok-2`、`grok-2-latest`、`grok-2-mini`。
   - **本地 Ollama**：仅有单一 `llama3`，缺少本地主流的 `deepseek-r1` 系列、`qwen2.5-coder` 系列、`llama3.3`。
2. **高频常用提供商缺失**：
   - **OpenRouter**：开发者极为常用的聚合提供商（且本机环境已有 `OPENROUTER_API_KEY`），直通 Claude 3.7、Gemini 2.5、DeepSeek R1、Llama 3.3 等。
   - **Anthropic (Claude)**：官方主流 Claude 3.7 Sonnet、Claude 3.5 Sonnet、Claude 3.5 Haiku。
   - **Google Gemini**：官方 OpenAI 兼容接口 (`https://generativelanguage.googleapis.com/v1beta/openai/`)，含 `gemini-2.5-pro`、`gemini-2.5-flash`、`gemini-2.0-flash`。

## 2. 架构设计与改动范围

### 2.1 涉及模块
1. `src/providers/presets.ts`:
   - `KNOWN_MODEL_WINDOWS`: 扩充各提供商最新官方公开的 contextWindow 与 maxOutputTokens。
   - `RETIRED_MODELS`: 移除误标为下线的现役主流模型（如 `deepseek-chat`、`deepseek-reasoner`、`moonshot-v1-*`）。
   - `PRESET_MAP`:
     - 修正 `openai` 默认模型为 `gpt-4o`。
     - 修正 `deepseek` 预设可自由选用 `deepseek-chat` / `deepseek-reasoner`。
     - 增加 `openrouter`、`anthropic`、`gemini` 预设。
   - `PROVIDER_PRESET_ORDER`: 纳入新预设并合理排序（国内常用 -> 国际常用 -> 聚合/本地）。
   - `MODEL_PROVIDER_AFFINITY`: 补齐各提供商新增模型的前缀与归属关联，确保 `/model` 和 `listProviderModelEntries` 准确归类。
2. `src/providers/resolve-llm.ts`:
   - `PROVIDER_API_KEY_ENV`: 增加新提供商环境变量映射：
     - `openrouter`: `OPENROUTER_API_KEY`
     - `anthropic`: `ANTHROPIC_API_KEY`
     - `gemini`: `GEMINI_API_KEY`
3. 单元测试更新：
   - 保证既有 28 项单测 100% 保持通过或平滑适配。
   - 新增针对扩充后的各提供商模型分类与窗口元数据的单元测试。

## 3. 兼容性与质量要求
- **零破坏性**：老模型 ID（如 `codestral-latest`、`deepseek-flash`、`qwen3.7-plus`）全部保留，确保已有会话不中断。
- **安全检查**：各提供商严格遵守单一 key 隔离原则，绝对不向未授权的主机或端点转发跨服务商 key。
- **构建测试**：TypeScript 编译零错误，所有单测 100% pass。
