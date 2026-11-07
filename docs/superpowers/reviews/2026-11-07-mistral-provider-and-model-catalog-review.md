# Qling 接入 Mistral AI 提供商与模型目录评审报告

- 日期：2026-11-07
- 目标：将 Mistral AI 设立为第一公民模型提供商，收录其官方与托管模型（包括 `deepseek-v4-1-flash-1017`），并在模型选择器中建立清晰、独立的厂商分组。

---

## 1. 变更清单与实施成果

### 1.1 Provider 与模型体系支持（`src/providers/presets.ts`）
- 在 `PRESET_MAP` 新增 `mistral`（Mistral AI）：
  - 默认端点：`https://api.mistral.ai/v1`
  - 默认模型：`codestral-latest`
  - 标签与上下文：256k 窗口、32k 输出。
- 在 `KNOWN_MODEL_WINDOWS` 登记 Mistral 官方与托管模型：
  - `codestral-latest`、`codestral-2508`
  - `deepseek-v4-1-flash-1017`（Mistral 官方托管 DeepSeek）
  - `mistral-large-latest`、`mistral-small-latest`、`ministral-8b-latest`
  - `zai-glm-5-3`（Mistral 官方托管智谱 GLM）
- 在 `MODEL_PROVIDER_AFFINITY` 中将上述模型明确归属于 `mistral` 提供商，彻底与 DeepSeek 官方直连、OpenAI 及 SiliconFlow 隔离。
- `ALIASES` 补充 `mistral` 与 `codestral` 别名。

### 1.2 凭据与解析支持（`src/providers/resolve-llm.ts`）
- `PROVIDER_API_KEY_ENV` 映射 `mistral: "MISTRAL_API_KEY"`。
- 支持 `QLING_LLM_API_KEY`（启动凭据）与 `MISTRAL_API_KEY`（服务商凭据）自动解算。

### 1.3 模型选择器效果
在 `/model` 切换器中呈现独立厂商分组：
```
▼ Mistral AI (当前) (7) ───────────────────
  ▸ codestral-latest          Mistral AI · codestral-latest
  ▸ codestral-2508            mistral · 已知模型
  ▸ deepseek-v4-1-flash-1017  mistral · 已知模型  (● 当前)
  ▸ mistral-large-latest      mistral · 已知模型
  ▸ mistral-small-latest      mistral · 已知模型
  ▸ ministral-8b-latest       mistral · 已知模型
  ▸ zai-glm-5-3               mistral · 已知模型
```

---

## 2. 验证证据

- **单元测试**：全套 28 项模型与切换器自动化测试（含新增 Mistral 专属断言测试）全部通过（28 pass, 0 fail）。
- **编译打包**：`npm run build` 成功完成，0 TypeScript 错误。
- **环境配置**：Windows 用户环境变量与 `~/.qling/.env` 已同步调整为 `provider=mistral`，`model=deepseek-v4-1-flash-1017`。
- **Doctor 诊断**：`qling doctor` 14 pass, 0 fail，`config: provider=mistral model=deepseek-v4-1-flash-1017`。
- **端到端推理**：执行 `qling run` 成功调用 Mistral 托管的 `deepseek-v4-1-flash-1017`。
