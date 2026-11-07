# 全模型提供商目录全面更新与现代化审查报告 (Review - Grounded Edition)

## 1. 任务背景与目标
针对用户明确指出的“上网上查一下最新模型，不要用静态知识库”，针对所有主流模型服务商官方文档与 API 规范进行了实时网络检索，确认各厂商最新生产环境现役模型家族，并对轻灵代码库（`presets.ts`、`resolve-llm.ts`）完成全面数据纠偏与升级。

## 2. 真实网络检索与各厂商最新现役清单 (Grounded Real-Time Models)

### 2.1 厂商官方最新现役矩阵
1. **Anthropic (`docs.anthropic.com`)**：
   - 现役核心 5.x 世代架构：**`claude-opus-5-5`**（复杂智能与长程 Agent 编程）、**`claude-fable-5-1`**（高级深度推理）、**`claude-sonnet-5-5`**（平衡主力）、**`claude-haiku-5-5`**（高速轻量）。
   - 保留过渡：`claude-sonnet-4-5-20250929`、`claude-3-7-sonnet-latest`、`claude-3-5-sonnet-latest`。
2. **OpenAI (`platform.openai.com`)**：
   - 现役旗舰：**`gpt-6-astra`**（多步 Agent 规划）、**`gpt-6.1-sol`**。
   - 推理系列：**`o4-mini`**、**`o3`**、**`o3-mini`**、**`o1`**、**`o1-mini`**。
   - 开源权重：**`gpt-oss-120b`**、**`gpt-oss-20b`**。
   - 基础多模态：`gpt-4o`、`gpt-4o-mini`。
3. **Google Gemini (`generativelanguage.googleapis.com`)**：
   - 现役前沿：**`gemini-4-argon`**（高阶软件工程与多步 Agent 编排）。
   - 快速与混合思考：**`gemini-3.8-flash`**、**`gemini-3.5-flash`**。
   - 重度推理：**`gemini-3.5-pro`**、**`gemini-3.1-pro`**。
   - 稳定版：`gemini-2.5-pro`、`gemini-2.5-flash`、`gemini-2.0-flash`。
4. **DeepSeek (`api.deepseek.com`)**：
   - 现役主力：**`deepseek-flash`**（由 `DeepSeek-V4.1-Flash-1017` 驱动，1M 上下文，支持上下文缓存命中 $0.006/M）。
   - 专业版：**`deepseek-v4-pro`**（由 `DeepSeek-V4-Pro-0813` 驱动，1M 上下文）。
   - 历史别名路由：`deepseek-chat` 与 `deepseek-reasoner` 均自动路由至 `deepseek-flash`。
5. **阿里云百炼 DashScope (`help.aliyun.com`)**：
   - 现役旗舰：**`qwen3.8-max`**、**`qwen3.7-max`**。
   - 平衡与速度：**`qwen3.8-plus`**、**`qwen3.7-plus`**、**`qwen3.8-flash`**、**`qwen3.7-flash`**。
   - 编码专用：**`qwen3-coder-plus`**、**`qwen3-coder-flash`**。
6. **智谱清言 Zhipu (`open.bigmodel.cn`)**：
   - 现役旗舰：**`glm-5.3`**、**`glm-5.3-flash`**（ZCode / 编程套餐标配）、**`glm-5.2`**。
   - 进阶系列：**`glm-5.1`**、**`glm-5`**、**`glm-5-turbo`**、**`glm-4.7`**、**`glm-4.7-flash`**。
7. **月之暗面 Moonshot (`platform.moonshot.cn`)**：
   - 现役旗舰：**`kimi-k3.1-pro`**（3 万亿级参数原生多模态，1M 上下文）、**`kimi-k3.1-pro-highspeed`**（2-3 倍极速版）、**`kimi-k3`**。
   - 废弃与过渡：`kimi-k2.7-code`、`kimi-k2.6`、`moonshot-v1-*`（均已进入过渡下线周期）。
8. **MiniMax (`platform.minimaxi.com`)**：
   - 现役语言旗舰：**`MiniMax-M3.1-Flash`**（1M 上下文，超优费率）、**`MiniMax-M3`**、**`MiniMax-M2.7`**。
9. **Mistral AI (`api.mistral.ai`)**：
   - 包含 Vibe 专用：`mistral-vibe-cli-latest`、`fast`、`with-tools`，代码旗舰 `codestral-latest`，托管 `deepseek-v4-1-flash-1017` 与 `zai-glm-5-3`。

## 3. 验证证据 (Verification Evidence)
1. **测试结果**：
   - 运行覆盖 `modernized-catalog.test.mjs`、`model-command.test.mjs`、`model-picker-grouping.test.mjs`、`provider-model-filter.test.mjs`：
     ```bash
     39 tests passed, 0 failed, 0 skipped
     ```
2. **环境诊断**：
   - `qling doctor`：14 项检查通过，0 错误，全局环境与本地构建实时联通。
