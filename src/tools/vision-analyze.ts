// ============================================================
// 轻灵 - vision_analyze 工具 (v0.3)
// 多模态视觉解析工具，支持分析图片、截图、网页 UI
// ============================================================

import { ToolDefinition, ToolResult } from "../types.js";
import axios from "axios";
import { getProviderPreset, lookupRetiredModel } from "../providers/presets.js";
import { resolveActiveLlm, resolveProviderApiKey } from "../providers/resolve-llm.js";
import * as fs from "fs/promises";
import * as path from "path";

export const DEFAULT_VISION_PROVIDER = "deepseek";
export const DEFAULT_VISION_MODEL = "deepseek-flash";
export const DEFAULT_VISION_ENDPOINT = "https://api.deepseek.com/chat/completions";
export const DEFAULT_VISION_MAX_TOKENS = 8192;

const LEGACY_NON_DEEPSEEK_VISION_MODELS = new Set([
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4-vision-preview",
  "gpt-4-turbo",
]);

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};

export interface VisionLlmConfig {
  provider: string;
  model: string;
  apiKey: string;
  endpoint: string;
  maxTokens: number;
  timeoutMs: number;
  maxImageSizeMb: number;
}

export interface VisionAnalyzeDeps {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  postImpl?: typeof axios.post;
}

export function resolveImageMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase().replace(/^\./, "");
  return IMAGE_MIME_BY_EXT[ext] || "image/png";
}

export function normalizeVisionModel(provider: string, rawModel?: string): string {
  const normalizedProvider = (provider || DEFAULT_VISION_PROVIDER).trim().toLowerCase() || DEFAULT_VISION_PROVIDER;
  const candidate = (rawModel ?? "").trim();
  const migrated = candidate ? (lookupRetiredModel(candidate) ?? candidate) : "";

  if (normalizedProvider === "deepseek") {
    if (!migrated || LEGACY_NON_DEEPSEEK_VISION_MODELS.has(migrated.toLowerCase())) {
      return DEFAULT_VISION_MODEL;
    }
    return migrated;
  }

  return migrated || getProviderPreset(normalizedProvider)?.model || DEFAULT_VISION_MODEL;
}

export function resolveVisionLlmConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): VisionLlmConfig {
  const active = resolveActiveLlm(env as NodeJS.ProcessEnv);
  const rawProvider = env.QLING_VISION_PROVIDER?.trim();
  const provider = (rawProvider || DEFAULT_VISION_PROVIDER).toLowerCase();

  const fallbackModel =
    provider === "deepseek"
      ? DEFAULT_VISION_MODEL
      : provider === active.provider.toLowerCase()
        ? active.model
        : getProviderPreset(provider)?.model || DEFAULT_VISION_MODEL;
  const model = normalizeVisionModel(provider, env.QLING_VISION_MODEL?.trim() || fallbackModel);

  const explicitVisionKey = env.QLING_VISION_API_KEY?.trim();
  const activeMatchesProvider = active.provider.trim().toLowerCase() === provider;
  const resolvedProviderKey = resolveProviderApiKey(provider, env as NodeJS.ProcessEnv, {
    startupProvider: String(env.QLING_LLM_STARTUP_PROVIDER || active.provider),
  }).apiKey.trim();
  const apiKey =
    explicitVisionKey ||
    (activeMatchesProvider && active.apiKey.trim() ? active.apiKey.trim() : "") ||
    resolvedProviderKey;

  let endpoint =
    env.QLING_VISION_ENDPOINT?.trim() ||
    (activeMatchesProvider ? active.endpoint.trim() : "") ||
    getProviderPreset(provider)?.endpoint ||
    "";

  if (!endpoint) {
    endpoint =
      provider === "openai"
        ? "https://api.openai.com/v1/chat/completions"
        : provider === "local" || provider === "ollama"
          ? "http://localhost:11434/v1/chat/completions"
          : DEFAULT_VISION_ENDPOINT;
  } else if (!endpoint.endsWith("/chat/completions")) {
    endpoint = endpoint.replace(/\/+$/, "") + "/chat/completions";
  }

  const rawMaxTokens = Number(env.QLING_VISION_MAX_TOKENS);
  const maxTokens = Number.isFinite(rawMaxTokens) && rawMaxTokens >= 256
    ? Math.min(65536, Math.floor(rawMaxTokens))
    : DEFAULT_VISION_MAX_TOKENS;

  const rawTimeoutMs = Number(env.QLING_VISION_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(rawTimeoutMs) && rawTimeoutMs > 0 ? rawTimeoutMs : 60000;

  const rawMaxImageSizeMb = Number(env.QLING_VISION_MAX_IMAGE_SIZE_MB);
  const maxImageSizeMb = Number.isFinite(rawMaxImageSizeMb) && rawMaxImageSizeMb > 0 ? rawMaxImageSizeMb : 10;

  return {
    provider,
    model,
    apiKey,
    endpoint,
    maxTokens,
    timeoutMs,
    maxImageSizeMb,
  };
}

export const visionAnalyzeTool: ToolDefinition = {
  name: "vision_analyze",
  description: "Analyze images, screenshots, or UI mockups using visual LLMs. Preserves rich artistic and structural details.",
  longDescription: `多模态视觉解析工具（默认统一使用 DeepSeek 多模态模型 deepseek-flash）。

**重要指引**:
- 当调用此工具后，Agent 应当在回答中**完整保留**模型返回的视觉意象、空间布局、风格描述和氛围分析。
- 除非用户明确要求提取特定文字，否则不要将丰富的叙述性描述仅压缩为表格。
- 艺术感和细节描述是此工具的核心产出。`,
  parameters: {
    type: "object",
    properties: {
      image_path: {
        type: "string",
        description: "Local path to the image file or base64 data",
      },
      image_url: {
        type: "string",
        description: "Public URL of the image",
      },
      prompt: {
        type: "string",
        description: "Specific instructions or questions for the visual analysis",
      },
      detail: {
        type: "string",
        enum: ["low", "high", "auto"],
        description: "Level of detail for analysis",
        default: "auto",
      }
    },
    required: ["prompt"],
  },
  paramSchema: {
    image_path: {
      type: "string",
      description: "本地图片路径。支持含空格路径。",
    },
    image_url: {
      type: "string",
      description: "远程图片 URL。确保 Agent 可出网。",
    },
    prompt: {
      type: "string",
      description: "具体的分析指令。例如：'分析这个登录页面的按钮是否居中'。",
      minLength: 5,
    },
    detail: {
      type: "string",
      description: "解析精细度。",
      enum: ["low", "high", "auto"],
      default: "auto",
    }
  },
  examples: [
    'vision_analyze image_path="screenshots/login.png" prompt="分析页面布局错位原因"',
    'vision_analyze image_url="https://example.com/chart.jpg" prompt="提取 2024 年 Q3 的收入数据"',
  ],
  scenes: ["visual", "debug", "frontend"],
  priority: 7,
  readOnly: true,
  destructive: false,
  concurrencySafe: true,
  effortHint: "medium",
};

export async function runVisionAnalyze(
  args: {
    image_path?: string;
    image_url?: string;
    prompt: string;
    detail?: "low" | "high" | "auto";
  },
  deps: VisionAnalyzeDeps = {}
): Promise<ToolResult> {
  const env = deps.env ?? process.env;
  const post = deps.postImpl ?? axios.post;

  // 1. 解析统一后的视觉模型配置（默认统一为 DeepSeek / deepseek-flash）
  const resolved = resolveVisionLlmConfig(env);
  const { provider, model, apiKey, endpoint, timeoutMs, maxImageSizeMb } = resolved;
  const internalArgs = args as {
    image_path?: string;
    image_url?: string;
    prompt: string;
    detail?: "low" | "high" | "auto";
    _is_retry?: boolean;
    _retry_max_tokens?: number;
  };
  const maxTokens = internalArgs._retry_max_tokens ?? resolved.maxTokens;

  // 只有非本地提供商才强制要求 API Key
  if (!apiKey && provider !== "local" && provider !== "ollama") {
    return {
      tool_call_id: "",
      output: `Error: Missing API Key for vision analysis (${provider}). Please check your configuration.`,
      is_error: true,
    };
  }

  try {
    const content: Array<Record<string, unknown>> = [{ type: "text", text: args.prompt }];

    if (args.image_path) {
      // 增强：支持直接传入 data:image/... Base64 URL 或含空格的本地文件路径
      const rawPath = args.image_path.replace(/["']/g, "").trim();
      if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(rawPath)) {
        content.push({
          type: "image_url",
          image_url: { url: rawPath, detail: args.detail || "auto" },
        });
      } else {
        const fullPath = path.isAbsolute(rawPath)
          ? rawPath
          : path.resolve(env.QLING_WORKSPACE_DIR || process.cwd(), rawPath);

        try {
          const buffer = await fs.readFile(fullPath);
          if (buffer.byteLength === 0) {
            return {
              tool_call_id: "",
              output: `Error: Image file at "${fullPath}" is empty (0 bytes).`,
              is_error: true,
            };
          }
          const maxBytes = maxImageSizeMb * 1024 * 1024;
          if (buffer.byteLength > maxBytes) {
            return {
              tool_call_id: "",
              output: `Error: Image at "${fullPath}" exceeds max size limit (${(buffer.byteLength / (1024 * 1024)).toFixed(1)} MB > ${maxImageSizeMb} MB).`,
              is_error: true,
            };
          }
          const base64 = buffer.toString("base64");
          const mimeType = resolveImageMimeType(fullPath);
          content.push({
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${base64}`, detail: args.detail || "auto" },
          });
        } catch {
          return {
            tool_call_id: "",
            output: `Error: Cannot read image at "${fullPath}". Please check if the file exists and the path is correct.`,
            is_error: true,
          };
        }
      }
    } else if (args.image_url) {
      content.push({
        type: "image_url",
        image_url: { url: args.image_url, detail: args.detail || "auto" }
      });
    } else {
      return {
        tool_call_id: "",
        output: "Error: Either image_path or image_url must be provided.",
        is_error: true,
      };
    }

    const resp = await post(
      endpoint,
      {
        model,
        messages: [{ role: "user", content }],
        max_tokens: maxTokens,
      },
      {
        headers: {
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          "Content-Type": "application/json",
        },
        timeout: timeoutMs,
      }
    );

    const choice = resp.data?.choices?.[0];
    const message = choice?.message;
    const primaryContent = typeof message?.content === "string" ? message.content.trim() : "";
    const reasoningContent = typeof message?.reasoning_content === "string" ? message.reasoning_content.trim() : "";

    // 自动重试机制：如果主输出为空（例如思考 token 触及上限），首次自动扩容 max_tokens 重试一次
    if (!primaryContent && !internalArgs._is_retry) {
      const expandedMaxTokens = Math.min(65536, Math.max(maxTokens * 2, 16384));
      return runVisionAnalyze(
        {
          ...args,
          _is_retry: true,
          _retry_max_tokens: expandedMaxTokens,
        } as any,
        deps
      );
    }

    const result = primaryContent || reasoningContent;

    return {
      tool_call_id: "",
      output: result ? `👁️ 视觉分析结果 (${model} @ ${provider}):\n\n${result}` : "[No analysis result]",
      meta: { model, provider }
    };
  } catch (err: any) {
    const msg = err.response?.data?.error?.message || err.message;
    let userHint = "";
    if (msg.includes("Incorrect API key") || msg.includes("invalid_api_key") || err.response?.status === 401) {
      userHint = `\n\n💡 提示: 检测到 API Key 鉴权失败。当前 Provider 为: ${provider}。 请确保您的 Key 能够访问该提供商的视觉模型。`;
      if (provider !== "local") {
         userHint += "\n如果您想使用本地模型，可设置 QLING_VISION_PROVIDER=local 并启动 Ollama。";
      }
    }
    return {
      tool_call_id: "",
      output: `Error: Vision analysis failed (${provider}): ${msg}${userHint}`,
      is_error: true,
      error: { code: "VISION_FAILED", message: msg, category: "network" }
    };
  }
}
