# Qling 视觉模型统一为 DeepSeek (DS) 与 `vision_analyze` 修复实施计划

- **日期**: 2026-10-24
- **设计文档**: `docs/superpowers/specs/2026-10-24-deepseek-vision-unification-design.md`

## 步骤清单

1. **更新 `src/tools/vision-analyze.ts`**
   - 抽出并导出 `resolveVisionLlmConfig(env)` 与 `resolveImageMimeType(filePath)`，将默认视觉 Provider 统一为 `deepseek`、默认模型统一为 `deepseek-flash`，并接入 `lookupRetiredModel` 迁移已下线模型与旧默认模型。
   - 将默认 `max_tokens` 提升至 `8192`（支持 `QLING_VISION_MAX_TOKENS` 配置），支持注入自定义请求函数以便单测隔离。
   - 增加 `reasoning_content` 兜底提取与空响应自动扩容 `max_tokens` 重试逻辑。
   - 支持 `.jpg` → `image/jpeg` 等标准 MIME 映射、`data:image/...` 直传、以及空文件/超大图片校验。
2. **更新 `src/config.ts` 与本地用户环境 `~/.qling/.env`**
   - 在 `src/config.ts` 中新增 `normalizeVisionConfig(config)`，确保配置加载时 `config.vision` 的默认与下线模型均统一归并到 `deepseek` / `deepseek-flash`。
   - 在 `~/.qling/.env` 中补充 `QLING_VISION_PROVIDER=deepseek`、`QLING_VISION_MODEL=deepseek-flash`、`QLING_VISION_ENDPOINT=https://api.deepseek.com`、`QLING_FEATURES_VISION_TOOL=true`。
3. **新增单元测试 `tests/unit/vision-analyze.test.mjs`**
   - 覆盖 DeepSeek 视觉配置解析、下线模型迁移、MIME 映射、`max_tokens: 8192` 请求体、空 `content` 重试与 `reasoning_content` 兜底。
4. **构建与新鲜验证**
   - 运行 `npm run build`。
   - 运行 `node --test tests/unit/vision-analyze.test.mjs tests/unit/model-presets-refresh.test.mjs`。
   - 使用 `runVisionAnalyze` 对 `C:\Users\Lenovo\_pdfbuild\preview_top.png` 执行实机调用验证。
