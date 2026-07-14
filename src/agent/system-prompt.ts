// ============================================================
// System prompt 组装 + 内省评估（从 AgentLoop 抽出）
// ============================================================

import path from "node:path";
import {
  buildRepoMapSection,
  buildSystemPrompt,
  buildReflectionPrompt,
} from "../pipeline/sections.js";
import type { PromptSectionRegistry } from "../types.js";
import type { Message, ToolCall } from "../types.js";
import type { MemoryStore } from "../memory.js";
import type { LlmChatResponse } from "../providers/llm-client.js";

export function findLastUserMessageContent(messages: Message[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role === "user") return messages[index].content;
  }
  return "";
}

export function buildRuntimeMetaSection(options: {
  provider?: string;
  endpoint?: string;
  workspaceDir?: string | null;
  fileCacheDir?: string;
  fileStateDir?: string;
  runtimeRootDir: string;
}): string {
  const workspace = options.workspaceDir ?? "(disabled)";
  const cache = options.fileCacheDir ?? path.join(options.runtimeRootDir, "cache");
  const state = options.fileStateDir ?? options.runtimeRootDir;
  return [
    "【Runtime Meta】",
    `provider=${options.provider ?? "default"}`,
    `endpoint=${options.endpoint ?? "default"}`,
    `workspace_dir=${workspace}`,
    `file_cache_dir=${cache}`,
    `file_state_dir=${state}`,
  ].join("\n");
}

export async function assembleSystemPrompt(options: {
  baseSystemPrompt: string;
  sectionRegistry: PromptSectionRegistry;
  memoryStore: MemoryStore;
  messages: Message[];
  provider?: string;
  endpoint?: string;
  workspaceDir?: string | null;
  fileCacheDir?: string;
  fileStateDir?: string;
  runtimeRootDir: string;
}): Promise<string> {
  const cognitiveIndex = (options.memoryStore as { getCognitiveIndex?: () => { getAllSymbols: () => unknown } })
    .getCognitiveIndex?.();
  if (cognitiveIndex) {
    try {
      const symbols = cognitiveIndex.getAllSymbols() as Parameters<typeof buildRepoMapSection>[0];
      options.sectionRegistry.register(buildRepoMapSection(symbols));
    } catch {
      // ignore repomap failures
    }
  }

  let memoryStr = "";
  if (options.messages.length > 0) {
    const lastUserMsg = findLastUserMessageContent(options.messages);
    const relevant = await options.memoryStore.getRelevant(lastUserMsg, 10);
    if (relevant.length > 0) {
      memoryStr = relevant.map((e) => "[" + e.source + "] " + e.content).join("\n");
    }
  }

  const sectionPrompt = buildSystemPrompt(options.sectionRegistry, {
    memory: memoryStr || undefined,
  });
  const parts = [
    options.baseSystemPrompt.trim(),
    buildRuntimeMetaSection({
      provider: options.provider,
      endpoint: options.endpoint,
      workspaceDir: options.workspaceDir,
      fileCacheDir: options.fileCacheDir,
      fileStateDir: options.fileStateDir,
      runtimeRootDir: options.runtimeRootDir,
    }),
    sectionPrompt,
  ].filter((p) => p && p.trim().length > 0);
  return parts.join("\n\n");
}

export type ReflectionDecision = "proceed" | "ask" | "block" | "warn";

export function heuristicReflect(tc: ToolCall): { decision: ReflectionDecision; reason: string } {
  const args = tc.arguments as { cmd?: string; command?: string };
  const cmd = (args.cmd || args.command || "").toLowerCase();
  if (cmd.includes("rm ") || cmd.includes("del ")) {
    return { decision: "warn", reason: "启发式拦截：检测到可能的删除操作。" };
  }
  return { decision: "proceed", reason: "启发式通过。" };
}

/**
 * Self-reflective pre-check for high-risk tools.
 * Uses optional chat callback; falls back to heuristics on failure.
 */
export async function reflectiveThink(
  tc: ToolCall,
  chat: (systemPrompt: string, overrides?: Record<string, unknown>) => Promise<LlmChatResponse>
): Promise<{ decision: ReflectionDecision; reason: string }> {
  const prompt = buildReflectionPrompt(tc.name, tc.arguments);
  try {
    const resp = await chat(prompt, { max_tokens: 200, temperature: 0 });
    const jsonStr = resp.content.match(/\{[\s\S]*\}/)?.[0] || "{}";
    const analysis = JSON.parse(jsonStr) as { decision?: ReflectionDecision; reason?: string };
    return {
      decision: analysis.decision || "proceed",
      reason: analysis.reason || "评估完成。",
    };
  } catch {
    return heuristicReflect(tc);
  }
}
