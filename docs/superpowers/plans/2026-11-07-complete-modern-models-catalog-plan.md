# 全量模型提供商最新模型目录与选择器恢复计划 (Plan)

日期：2026-11-07

## 1. 实施步骤
1. **更新 `src/providers/presets.ts`**：
   - 补充 `MODEL_PROVIDER_AFFINITY`：加入 `kimi-k3.1-pro`、`deepseek-reasoner`、`glm-4-plus`、`mimo-v2` 等缺失项。
   - 完善 `KNOWN_MODEL_WINDOWS`：补充 Qwen 3.8/3.7、Claude 5.x、Gemini 4/3.8、GLM 5.x、Kimi k3.x、MiniMax M3.1、MiMo v2.6 等主流模型的上下文与输出 token 规格。
   - 修复 `knownModelsForProvider`：合并 `MODEL_PROVIDER_AFFINITY` 和 `KNOWN_MODEL_WINDOWS` 作为候选集合，彻底解除过滤限制，使所有新模型都能完整被输出给列表与选择器。
2. **适配与增强测试 `tests/unit/provider-model-filter.test.mjs`**：
   - 更新 `providerModelNames` 断言，确保所有新增模型全部被正确检索。
3. **构建与测试验证**：
   - 运行 `npm run build`。
   - 运行单元测试套件：`node --test tests/unit/provider-model-filter.test.mjs tests/unit/model-picker-grouping.test.mjs tests/unit/model-picker-tui.test.mjs tests/unit/model-command.test.mjs`。
   - 运行全量测试确认无回归。
4. **生成验证证据与撰写 Review**：
   - 执行脚本直接列出所有提供商的最新模型，确认每个提供商都能正常返回其全套最新模型。
   - 编写 `docs/superpowers/reviews/2026-11-07-complete-modern-models-catalog-review.md`。
