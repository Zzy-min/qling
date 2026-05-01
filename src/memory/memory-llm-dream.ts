// ============================================================
// 轻灵 - LLM 增强记忆提取
// 用 LLM 从对话中提取结构化记忆，regex 为降级兜底
// ============================================================

import axios from "axios";
import { extractDreamMemories } from "../memory.js";
import type { LLMDreamConfig } from "../types.js";

const DREAM_PROMPT = `你是一个记忆提取助手。从以下对话中提取值得长期记住的信息。

提取规则：
1. 项目决策（选用了什么技术/框架/方案）
2. 文件路径（重要的源文件、配置文件）
3. 用户偏好（编码风格、工具偏好）
4. 错误模式（遇到的 bug 及其解决方案）
5. 关键上下文（工作目录、环境信息）

返回 JSON 数组，每个元素是一句简洁的陈述（不超过50字）。
如果没有值得记忆的内容，返回空数组 []。
只返回 JSON 数组，不要其他文字。`;

export async function extractDreamMemoriesLLM(
  transcript: string[],
  turnCount: number,
  config: LLMDreamConfig
): Promise<string[]> {
  if (!config.enabled || !config.apiKey) {
    return extractDreamMemories(
      { turnCount, transcript },
      { enabled: true, turnThreshold: 24, transcriptWindow: 4 }
    );
  }

  try {
    const recent = transcript.slice(-6);
    const combined = recent.join("\n---\n");

    const resp = await axios.post(
      config.endpoint + "/chat/completions",
      {
        model: config.model,
        messages: [
          { role: "system", content: DREAM_PROMPT },
          { role: "user", content: combined.slice(0, 4000) },
        ],
        max_tokens: config.maxTokens,
        temperature: 0.3,
      },
      {
        headers: {
          Authorization: "Bearer " + config.apiKey,
          "Content-Type": "application/json",
        },
        timeout: 30_000,
      }
    );

    const content = resp.data.choices?.[0]?.message?.content?.trim() ?? "";
    // parse JSON array from response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item: unknown) => String(item).trim())
          .filter((s: string) => s.length > 0 && s.length <= 200);
      }
    }

    // fallback to regex
    return extractDreamMemories(
      { turnCount, transcript },
      { enabled: true, turnThreshold: 24, transcriptWindow: 4 }
    );
  } catch {
    // fallback to regex on any error
    return extractDreamMemories(
      { turnCount, transcript },
      { enabled: true, turnThreshold: 24, transcriptWindow: 4 }
    );
  }
}
