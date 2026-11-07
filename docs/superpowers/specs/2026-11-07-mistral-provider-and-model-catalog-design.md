# Qling 接入 Mistral AI 提供商与模型目录设计规范

- 状态：实施中（2026-11-07）

## 1. 目标与背景

用户反馈：“所以我想让你添加到此模型提供商里，你的模型提供商的区分很糟糕”。

### 问题根因分析：
1. 缺少独立 Mistral 提供商预设：此前 Qling 的预设列表（`PRESET_MAP`）未收录 `mistral`，导致用户使用 Mistral API Key 时不得不以 `openai` 兼容模式配置。
2. 模型提供商归属混乱：
   - Mistral 平台（La Plateforme，`api.mistral.ai`）除了自有 `codestral-latest`、`mistral-large-latest` 等，还官方托管了 `deepseek-v4-1-flash-1017` 与 `zai-glm-5-3`。
   - 由于缺乏 `mistral` 独立 Provider，在模型选择器中，这些模型只能被算作 `openai` 的“当前模型”或未知模型，厂商区分失真。
3. 环境变量映射缺失：`PROVIDER_API_KEY_ENV` 缺少 `mistral: "MISTRAL_API_KEY"`，无法进行标准的服务商凭据隔离。

---

## 2. 方案设计

### 2.1 增加原生 Mistral AI Provider
- **预设配置**：
  - `id`: `"mistral"`
  - `displayName`: `"Mistral AI"`
  - `provider`: `"mistral"`
  - `endpoint`: `"https://api.mistral.ai/v1"`
  - `model`: `"codestral-latest"`
  - `keyHint`: `"Mistral API Key"`
  - `requiresApiKey`: `true`
  - `tags`: `["global", "recommended"]`
  - `contextWindow`: 256000
  - `maxOutputTokens`: 32768
- **排序**：将 `mistral` 加入 `PROVIDER_PRESET_ORDER`。
- **别名**：`ALIASES.mistral = "mistral"`, `ALIASES.codestral = "mistral"`.

### 2.2 收录 Mistral 平台核心模型与窗口
在 `KNOWN_MODEL_WINDOWS` 与 `MODEL_PROVIDER_AFFINITY` 中登记：
- `codestral-latest`（Mistral 代码旗舰，256k 窗口）
- `deepseek-v4-1-flash-1017`（Mistral 官方托管的 DeepSeek Flash，128k 窗口）
- `mistral-large-latest`（Mistral 通用旗舰，128k 窗口）
- `mistral-small-latest`（Mistral 轻量模型，128k 窗口）
- `ministral-8b-latest`（Ministral 端侧模型，128k 窗口）
- `zai-glm-5-3`（Mistral 官方托管智谱 GLM 5.3）

### 2.3 密钥与安全适配
- `PROVIDER_API_KEY_ENV.mistral = "MISTRAL_API_KEY"`。
- 支持从 `MISTRAL_API_KEY` 或启动凭据 `QLING_LLM_API_KEY` 中安全解析，不落盘明文。

### 2.4 模型选择器（TUI / Text）交互效果
在模型选择器中拥有专属分组：
```
▼ Mistral AI (6) ─────────────────────────
  ▸ codestral-latest            Mistral AI · codestral-latest
  ▸ deepseek-v4-1-flash-1017    mistral · 已知模型
  ▸ mistral-large-latest        mistral · 已知模型
  ▸ mistral-small-latest        mistral · 已知模型
  ▸ ministral-8b-latest         mistral · 已知模型
  ▸ zai-glm-5-3                 mistral · 已知模型
```
清晰区别于独立的深度求索官方（DeepSeek）、阿里云（Qwen）与 OpenAI 厂商。
