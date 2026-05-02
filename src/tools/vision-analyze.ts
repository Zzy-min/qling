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
  description: "Analyze images, screenshots, or UI mockups using visual LLMs. Supports issue identification and UI debugging.",
  longDescription: `多模态视觉解析工具。支持分析本地图片、页面截图或远程 URL 图片。

**使用场景**:
- 调试前端 UI 布局问题
- 解析图表、流程图或架构图
- 验证视觉改动是否符合预期
- 提取图片中的文字或关键结构信息

**输出**:
- 强类型 JSON，包含场景描述、问题定位、证据片段和修复建议。`,
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
  const provider = process.env.QINGLING_VISION_PROVIDER || "openai";
  const model = process.env.QINGLING_VISION_MODEL || "gpt-4o";
  const apiKey = process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || "";

  // 只有非本地提供商才强制要求 API Key
  if (!apiKey && provider !== "local") {
    return {
      tool_call_id: "",
      output: "Error: Missing API Key for vision analysis. Please set OPENAI_API_KEY or DEEPSEEK_API_KEY.",
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
        : path.resolve(process.env.QINGLING_WORKSPACE_DIR || process.cwd(), rawPath);
      
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

    const endpoint = provider === "openai" 
      ? "https://api.openai.com/v1/chat/completions" 
      : provider === "deepseek"
        ? "https://api.deepseek.com/chat/completions"
        : process.env.QINGLING_VISION_ENDPOINT || "http://localhost:11434/v1/chat/completions";

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
        timeout: Number(process.env.QINGLING_VISION_TIMEOUT_MS) || 60000,
      }
    );

    const result = resp.data.choices?.[0]?.message?.content || "[No analysis result]";
    return {
      tool_call_id: "",
      output: `👁️ 视觉分析结果 (${model}):\n\n${result}`,
      meta: { model, provider }
    };
  } catch (err: any) {
    const msg = err.response?.data?.error?.message || err.message;
    return {
      tool_call_id: "",
      output: `Error: Vision analysis failed: ${msg}`,
      is_error: true,
      error: { code: "VISION_FAILED", message: msg, category: "network" }
    };
  }
}
