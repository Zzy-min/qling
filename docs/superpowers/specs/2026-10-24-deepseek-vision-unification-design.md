# Qling 视觉模型统一为 DeepSeek (DS) 与 `vision_analyze` 空返回修复设计文档

- **日期**: 2026-10-24
- **仓库**: `C:\Users\Lenovo\projects\qling`
- **状态**: Approved for implementation

## 1. 背景与根因诊断

在近期 PDF 渲染与视觉核验任务中，`vision_analyze` 连续三次返回 `[No analysis result]`（`meta: { model: "deepseek-flash", provider: "deepseek" }`），导致 Agent 只能回退到字体嵌入与字形宽度检测，无法完成真正的视觉看图确认。

通过复盘会话日志（`~/.qling/sessions/session-1792681921317.json`）并对 `https://api.deepseek.com/chat/completions` 进行实测探测，定位到以下核心根因：

1. **`max_tokens: 1000` 被推理模型的 `reasoning_content` 耗尽（直接根因）**
   - `src/tools/vision-analyze.ts` 第 167 行硬编码了 `max_tokens: 1000`。
   - `deepseek-flash`（DeepSeek V4.1 Flash）属于原生多模态 + 思考（Reasoning）模型，`max_tokens` 同时限制 `reasoning_tokens + content_tokens` 的总和。
   - 实测分析 `preview_top.png` 时，`deepseek-flash` 需要约 `1470` 个 `reasoning_tokens` 来逐项核对标题、引文框、表格行尾与边距，随后才输出约 `307` 个 `content` token（合计 `1777` tokens）。
   - 在 `max_tokens: 1000` 限制下，请求在 `reasoning_tokens: 1000` 时触发 `finish_reason: "length"` 截断，此时 `message.content` 为空字符串 `""`；而 `vision-analyze.ts` 仅读取 `message.content`，且自动重试仍使用 `max_tokens: 1000`，导致每次必现 `[No analysis result]`。
2. **缺少 `reasoning_content` 兜底与截断扩容重试**
   - 当模型因输出较长在 `finish_reason === "length"` 时若 `message.content` 为空但 `message.reasoning_content` 已有详细视觉分析结论，`vision-analyze.ts` 未做兜底提取，也未在重试时提高 `max_tokens`。
3. **视觉模型配置未全面统一收敛到 DeepSeek (`deepseek` / `deepseek-flash`)**
   - `vision-analyze.ts` 在未显式设置 `QLING_VISION_PROVIDER` 时直接跟随 `active.provider`，若主对话临时切到不支持视觉的 Provider 或旧配置残留了已下线模型名（如 `deepseek-v4-flash-vision-exp`、`deepseek-chat`、`gpt-4o`），未统一归并到 `deepseek` / `deepseek-flash`。
   - 本地图片的 MIME 类型构造直接使用文件扩展名拼接（例如 `.jpg` 生成非标准的 `data:image/jpg;base64,...` 而非 `image/jpeg`），且未直接兼容传入 `data:image/...` Base64 Data URL 的场景。

## 2. 设计方案

### 2.1 视觉配置统一归并到 DeepSeek (`deepseek` / `deepseek-flash`)

1. **`resolveVisionLlmConfig(env)`（`src/tools/vision-analyze.ts`）**：
   - **默认 Provider**：优先读取 `QLING_VISION_PROVIDER`，未设置时默认统一为 `"deepseek"`（即使用户未单独配置 `QLING_VISION_PROVIDER`，也默认走 DeepSeek 视觉能力）。
   - **默认与归一化 Model**：
     - 优先读取 `QLING_VISION_MODEL`；若未设置，当 `provider === "deepseek"` 时固定默认 `"deepseek-flash"`。
     - 通过 `lookupRetiredModel(model)` 自动将已下线模型（如 `deepseek-v4-flash-vision-exp`、`deepseek-v4-flash`、`deepseek-chat`、`deepseek-reasoner`）平滑迁移为 `"deepseek-flash"`。
     - 当 `provider === "deepseek"` 且模型名为旧版 OpenAI 默认值（如 `gpt-4o`、`gpt-4o-mini`）时，自动归一化为 `"deepseek-flash"`。
   - **API Key 与 Endpoint 解析**：
     - 支持 `QLING_VISION_API_KEY`，否则当 `provider === active.provider` 时复用 `active.apiKey`，或通过 `resolveProviderApiKey(provider, env)` / `DEEPSEEK_API_KEY` 获取密钥。
     - Endpoint 默认指向 `https://api.deepseek.com/chat/completions`，并自动补齐 `/chat/completions` 后缀。
2. **`normalizeVisionConfig`（`src/config.ts`）**：
   - 在配置加载阶段归一化 `config.vision`：确保默认 provider 为 `"deepseek"`、model 为 `"deepseek-flash"`，并将已下线或旧默认模型自动归一化为 `"deepseek-flash"`。

### 2.2 修复 `vision_analyze` 空返回与增强多模态鲁棒性

1. **提升 `max_tokens` 默认预算**：
   - 将默认 `max_tokens` 从 `1000` 提升至 `8192`（可通过环境变量 `QLING_VISION_MAX_TOKENS` 覆盖，范围 `256`～`65536`），确保 `deepseek-flash` 拥有充足的 `reasoning_tokens + content_tokens` 预算。
2. **输出提取与重试策略**：
   - 优先提取 `message.content.trim()`。
   - 若 `message.content` 为空且尚未重试，自动将 `max_tokens` 翻倍（至少 `16384`）重试一次。
   - 若重试后 `message.content` 仍为空但 `message.reasoning_content` 非空，则使用 `message.reasoning_content.trim()` 作为分析结果返回，彻底杜绝已生成分析却返回 `[No analysis result]` 的情况。
3. **标准 MIME 映射与 Data URL 兼容**：
   - 新增 `resolveImageMimeType(filePath)`：`.jpg`/`.jpeg` → `image/jpeg`、`.png` → `image/png`、`.webp` → `image/webp`、`.gif` → `image/gif`、`.bmp` → `image/bmp`、`.svg` → `image/svg+xml`。
   - 若 `image_path` 本身已是 `data:image/...;base64,...` 格式，直接作为 Data URL 发送，不再尝试 `fs.readFile`。
   - 校验本地图片大小不超过 `QLING_VISION_MAX_IMAGE_SIZE_MB`（默认 `10` MB）且非空文件。

## 3. 验证计划

1. **单元测试**：新增 `tests/unit/vision-analyze.test.mjs`，覆盖：
   - 默认视觉配置统一解析为 `provider: "deepseek"`、`model: "deepseek-flash"`、`endpoint: "https://api.deepseek.com/chat/completions"`。
   - 已下线模型（`deepseek-v4-flash-vision-exp` 等）及旧默认模型（`gpt-4o`）在 DeepSeek 下自动归一化为 `deepseek-flash`。
   - `.jpg` 等扩展名正确映射为 `image/jpeg`，支持 `data:image/...` 直传。
   - 默认发送 `max_tokens: 8192`；当首轮返回空 `content` 时自动扩容 `max_tokens` 重试；当 `content` 为空但 `reasoning_content` 非空时正确回退输出。
2. **实机端到端验证**：
   - 直接调用构建后的 `runVisionAnalyze` 对 `C:\Users\Lenovo\_pdfbuild\preview_top.png` 执行真实 DeepSeek 视觉分析，确认返回完整的中文排版核验结论。
