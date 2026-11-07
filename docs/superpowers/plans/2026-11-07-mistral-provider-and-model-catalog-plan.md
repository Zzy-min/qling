# Qling 接入 Mistral AI 提供商实施计划

- 状态：准备实施（2026-11-07）

## 任务拆解与清单

### 阶段 1：Provider 与模型数据登记（`src/providers/presets.ts`）
- [ ] 在 `KNOWN_MODEL_WINDOWS` 登记 `codestral-latest`、`codestral-2508`、`deepseek-v4-1-flash-1017`、`mistral-large-latest`、`mistral-small-latest`、`ministral-8b-latest`、`zai-glm-5-3` 窗口信息。
- [ ] 在 `PROVIDER_PRESET_ORDER` 中加入 `"mistral"`。
- [ ] 在 `PRESET_MAP` 中增加 `mistral` 条目。
- [ ] 在 `ALIASES` 增加 `mistral` 与 `codestral` 别名。
- [ ] 在 `MODEL_PROVIDER_AFFINITY` 中将上述 Mistral 官方及托管模型明确绑定至 `mistral` 提供商。

### 阶段 2：环境与解析适配（`src/providers/resolve-llm.ts`）
- [ ] 在 `PROVIDER_API_KEY_ENV` 中添加 `mistral: "MISTRAL_API_KEY"`。

### 阶段 3：测试编写与验证
- [ ] 在 `tests/unit/model-picker-grouping.test.mjs` 中添加 Mistral 提供商与 `deepseek-v4-1-flash-1017` 归属断言。
- [ ] 执行全套相关单元测试并保证通过。
- [ ] 执行 `npm run build`。
- [ ] 更新本地运行配置为原生 `provider=mistral`，执行真实推理新鲜验证。
