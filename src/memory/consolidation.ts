import axios from "axios";
import type { PersistedEntry } from "../types.js";

export interface MemoryOperation {
  action: "ADD" | "UPDATE" | "DELETE" | "NOOP";
  fact: string;
  targetId?: string;
  reason?: string;
}

const CONSOLIDATE_PROMPT = `你是一个记忆合并与冲突消解专家。请比对以下“新提取的候选记忆”和“已有的长期记忆”，消除冲突、冗余，并输出合并整理指令。

合并原则：
1. 冲突消解：若候选记忆与已有记忆存在矛盾（例如，已有记忆说“当前使用 python 3.12”，而新候选记忆说“项目已升级到 python 3.13”），应该将旧记忆标记为 DELETE（或用 UPDATE 修正它），不要保留过期的矛盾事实。
2. 消除冗余：如果候选记忆的内容已经包含在已有记忆中，或者意义完全一致，则无需重复添加，标记为 NOOP。
3. 新知识添加：若候选记忆是全新且不矛盾的信息，标记为 ADD。
4. 旧知识删除：若已有记忆已被新的会话上下文判定为过时或无效，标记为 DELETE。

请返回一个 JSON 数组，包含每个记忆的操作结果，格式如下：
[
  {
    "action": "ADD",
    "fact": "新事实描述"
  },
  {
    "action": "UPDATE",
    "targetId": "mem_xxx",
    "fact": "修正后的事实描述",
    "reason": "更新理由"
  },
  {
    "action": "DELETE",
    "targetId": "mem_yyy",
    "reason": "删除理由"
  }
]

请只返回 JSON 格式数据，不要包含 Markdown 格式标记或其他任何文本。`;

export async function consolidateMemoriesLLM(
  newCandidates: string[],
  existingMemories: PersistedEntry[],
  config: { apiKey: string; endpoint: string; model: string }
): Promise<MemoryOperation[]> {
  if (newCandidates.length === 0) return [];
  if (!config.apiKey) {
    // If no API key, default to ADD for all new candidates that are not exact matches.
    const existingContents = new Set(existingMemories.map(e => e.content));
    return newCandidates
      .filter(c => !existingContents.has(c))
      .map(c => ({ action: "ADD", fact: c }));
  }

  try {
    const payloadInput = {
      candidates: newCandidates,
      existing: existingMemories.map(e => ({ id: e.id, fact: e.content })),
    };

    const resp = await axios.post(
      config.endpoint + "/chat/completions",
      {
        model: config.model,
        messages: [
          { role: "system", content: CONSOLIDATE_PROMPT },
          { role: "user", content: JSON.stringify(payloadInput) },
        ],
        max_tokens: 800,
        temperature: 0.2,
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
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        return parsed as MemoryOperation[];
      }
    }
  } catch (err) {
    console.error("[MemoryConsolidation] LLM request failed, falling back to direct add:", err);
  }

  // Fallback
  const existingContents = new Set(existingMemories.map(e => e.content));
  return newCandidates
    .filter(c => !existingContents.has(c))
    .map(c => ({ action: "ADD", fact: c }));
}
