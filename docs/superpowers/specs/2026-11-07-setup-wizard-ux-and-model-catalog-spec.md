# Qling 连接向导 UI 体验与模型目录重构规范 (Setup Wizard UX & Model Catalog Spec)

- **状态**: 草案 / 设计中
- **日期**: 2026-11-07
- **作者**: Antigravity Pair Programmer
- **影响范围**: `src/cli/setup.ts`, `src/providers/presets.ts`, 关联单元测试

---

## 1. 背景与问题定义

用户在使用 `qling setup` 连接向导时，遇到三大体验与功能痛点：
1. **根本没有列出相关模型**：
   在现有的 `setup.ts` 中，`models` 数组仅在选择账号授权（`chatgpt_oauth` / `grok_cli_session`）且远端接口调用成功时才被填充。对于广大使用 API Key 的服务商（DeepSeek、通义千问、Kimi、Claude、OpenAI、智谱、MiniMax 等）以及本地模型，`models` 恒为空数组 `[]`。
   用户在终端只能看到一句干瘪的 `模型 ID [deepseek-chat]: `，完全不知道该服务商有哪些模型可选、模型全称是什么。
2. **UI 风格与 Qling 整体严重脱节**：
   Qling 拥有统一的竹青禅意/现代终端设计语言（如 `model-picker`、`chrome`、`overlay-panel`），具备圆角框线（`╭─ ─╮`、`│`、`╰─ ─╯`）、状态徽标（`★`、`🔒`、`⚡`、`○`）及层次分明的段落排版。
   而 `setup.ts` 依然是简陋的无格式黑白单行问答，文字杂乱拥挤，缺乏任何视觉分层与卡片感。
3. **向导流程不够简便与智能**：
   - 输入仅认生硬的数字索引，不支持提供商别名（如 `ds`, `qwen`, `kimi`, `grok`）；
   - 官方预设已包含标准 Endpoint，提示语不够直观，用户不敢直接回车；
   - 模型不支持通过序号（`1`, `2`）直选，必须逐字输入长模型名。

---

## 2. 解决方案与核心架构设计

### 2.1 模型目录无缝填充 (Model Catalog Auto-Population)
在 `src/cli/setup.ts` 中，当获取到 `profile.provider` 后：
- 如果远端账号未提供模型列表（或对于 API Key / Local 服务商）：
  调用 `listProviderModelEntries(profile.provider, profile.model)`，自动加载该提供商的所有官方预设模型与已知窗口模型；
- 如果是 DeepSeek，提供 `deepseek-chat`、`deepseek-reasoner`、`deepseek-flash` 等常用模型；
- 如果是通义千问，提供 `qwen-max`、`qwen-plus`、`qwen-turbo` 等；
- 如果是 Kimi，提供 `kimi-k2.5`、`moonshot-v1-8k`、`moonshot-v1-32k` 等；
- 如果是 Claude / OpenAI / Grok / Ollama，同样列出对应生态的最新代表模型；
- 格式化输出编号候选菜单：
  ```
  ╭─ 候选模型列表 ──────────────────────────────────────────╮
  │  1. deepseek-chat (当前推荐)                            │
  │  2. deepseek-reasoner (深度思考)                        │
  │  3. deepseek-flash                                     │
  ╰────────────────────────────────────────────────────────╯
  ```
  用户直接输入 `1`、`2` 即可快速选中，按 Enter 则默认采用推荐模型，同时也支持直接输入任意自定义模型 ID。

### 2.2 视觉规范对齐 Qling TUI
设计与 Qling 控制台一致的边框与字符样式：
1. **向导 Header 横幅**:
   ```
   ╭────────────────────────────────────────────────────────╮
   │  轻灵 Qling · 快速连接与模型配置向导                   │
   ╰────────────────────────────────────────────────────────╯
   ```
2. **分类清晰的连接方式菜单**:
   保留现有 `/ChatGPT.*Grok.*API/s` 文本兼容性前提下，引入徽标化排版：
   - `1. ★ ChatGPT 官方账号授权 (免 API Key，支持 OAuth 订阅)`
   - `2. ★ Grok Build CLI 授权 (复用 xAI 官方 CLI 会话)`
   - `3. 🔒 API Key 直连 (DeepSeek / 通义千问 / Kimi / Claude / OpenAI 等)`
   - `4. ○ 本地开源模型 (Ollama / Local，免 Key 本地运行)`
   - `5. 稍后配置 (暂存退出)`
3. **优雅的连接配置摘要卡片**:
   配置完成前展示类似 Qling Info Card 的边框摘要，清楚列明提供商、接口地址、默认模型、认证加密方式。

### 2.3 流程交互优化
1. **提供商快速匹配**:
   在选择提供商时，用户不仅可以输入序号 `1`, `2`, `3`...，还可以输入别名缩写，如 `deepseek`, `ds`, `qwen`, `kimi`, `claude`, `openai`, `ollama`。
2. **直观的默认值说明**:
   `Endpoint [直接回车使用官方推荐: https://api.deepseek.com]: `
   清晰让用户知道无需修改即可一路 Enter。

### 2.4 测试兼容性保障
- 保持 `runConnectionWizard` 内部与 `prompt.ask` / `services` 的交互契约不变；
- 保持数字输入模式完全向后兼容；
- 确保 `tests/unit/first-run-auth.test.mjs` 与 `tests/unit/auth-final-regressions.test.mjs` 中所有自动化测试夹具 100% 通过。
