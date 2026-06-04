// ============================================================
// 轻灵 - vision_analyze 工具 (v0.3)
// 多模态视觉解析工具，支持分析图片、截图、网页 UI
// ============================================================

import { ToolDefinition, ToolResult } from "../types.js";
import axios from "axios";
import * as fs from "fs/promises";
import * as path from "path";

export const visionAnalyzeTool: ToolDefinition = {
  name: "vision_analyze",
  description: "Analyze images, screenshots, or UI mockups using visual LLMs. Preserves rich artistic and structural details.",
  longDescription: `多模态视觉解析工具。

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

export async function runVisionAnalyze(args: {
  image_path?: string;
  image_url?: string;
  prompt: string;
  detail?: "low" | "high" | "auto";
}): Promise<ToolResult> {
  // 1. 优先级：Vision 专用变量 > LLM 通用变量 > 默认值
  const provider = process.env.QLING_VISION_PROVIDER || process.env.QLING_LLM_PROVIDER || "openai";
  const model = process.env.QLING_VISION_MODEL || process.env.QLING_LLM_MODEL || "gpt-4o";
  const apiKey = process.env.QLING_LLM_API_KEY || process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || "";
  
  // 2. 解析 Endpoint
  let endpoint = process.env.QLING_VISION_ENDPOINT || process.env.QLING_LLM_ENDPOINT;
  if (!endpoint) {
    endpoint = provider === "openai" 
      ? "https://api.openai.com/v1/chat/completions" 
      : provider === "deepseek"
        ? "https://api.deepseek.com/chat/completions"
        : "http://localhost:11434/v1/chat/completions";
  } else {
    // 确保 endpoint 包含 chat/completions 路径
    if (!endpoint.endsWith("/chat/completions")) {
      endpoint = endpoint.replace(/\/$/, "") + "/chat/completions";
    }
  }

  // 只有非本地提供商才强制要求 API Key
  if (!apiKey && provider !== "local") {
    return {
      tool_call_id: "",
      output: `Error: Missing API Key for vision analysis (${provider}). Please check your configuration.`,
      is_error: true,
    };
  }

  try {
    let content: any[] = [{ type: "text", text: args.prompt }];

    if (args.image_path) {
      // 增强：处理含空格的路径并规范化
      const rawPath = args.image_path.replace(/["']/g, "").trim();
      const fullPath = path.isAbsolute(rawPath) 
        ? rawPath 
        : path.resolve(process.env.QLING_WORKSPACE_DIR || process.cwd(), rawPath);
      
      try {
        const buffer = await fs.readFile(fullPath);
        const base64 = buffer.toString("base64");
        const ext = path.extname(fullPath).toLowerCase().slice(1) || "png";
        content.push({
          type: "image_url",
          image_url: { url: `data:image/${ext};base64,${base64}`, detail: args.detail || "auto" }
        });
      } catch (e) {
        return {
          tool_call_id: "",
          output: `Error: Cannot read image at "${fullPath}". Please check if the file exists and the path is correct.`,
          is_error: true,
        };
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

    const resp = await axios.post(
      endpoint,
      {
        model,
        messages: [{ role: "user", content }],
        max_tokens: 1000,
      },
      {
        headers: {
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          "Content-Type": "application/json",
        },
        timeout: Number(process.env.QLING_VISION_TIMEOUT_MS) || 60000,
      }
    );

    const result = resp.data.choices?.[0]?.message?.content || "";
    
    // 自动重试机制：如果结果为空，尝试重新调用一次
    const internalArgs = args as any;
    if (!result && !internalArgs._is_retry) {
      console.warn("⚠️ 视觉分析返回空结果，正在尝试自动重试...");
      return runVisionAnalyze({ ...args, _is_retry: true } as any);
    }

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
