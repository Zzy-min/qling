// ============================================================
// 记忆生命周期（从 AgentLoop 抽出）：auto-dream 整理
// domain 层 — 不依赖 agent-loop / TUI / CLI
// ============================================================

import type { Message } from "../types.js";
import { MemoryStore, extractDreamMemories } from "../memory.js";
import { extractDreamMemoriesLLM } from "./memory-llm-dream.js";

export interface AutoDreamOptions {
  messages: Message[];
  turnCount: number;
  memoryStore: MemoryStore;
  memoryDreamLLMEnabled: boolean;
  memoryDreamTurnThreshold: number;
  memoryMaxEntries: number;
  model: string;
  apiKey: string;
  endpoint: string;
}

/**
 * Run one auto-dream pass. Returns number of changed memory entries.
 * Failures are swallowed by the caller if desired; this function rethrows only unexpected errors.
 */
export async function runAutoDream(options: AutoDreamOptions): Promise<number> {
  const transcript = options.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => m.content);

  let memories: string[];
  let changedCount = 0;

  if (options.memoryDreamLLMEnabled) {
    memories = await extractDreamMemoriesLLM(transcript, options.turnCount, {
      enabled: true,
      model: options.model,
      maxTokens: 300,
      apiKey: options.apiKey,
      endpoint: options.endpoint || "https://api.deepseek.com",
    });

    const { consolidateMemoriesLLM } = await import("./consolidation.js");
    const existing = options.memoryStore.exportPersisted();
    const ops = await consolidateMemoriesLLM(memories, existing, {
      apiKey: options.apiKey,
      endpoint: options.endpoint || "https://api.deepseek.com",
      model: options.model,
    });

    options.memoryStore.applyOperations(ops, "workspace");
    changedCount = ops.filter((op) => op.action !== "NOOP").length;
  } else {
    memories = await extractDreamMemories(
      { turnCount: options.turnCount, transcript },
      {
        enabled: true,
        turnThreshold: options.memoryDreamTurnThreshold,
        transcriptWindow: 4,
      }
    );
    const existingContents = new Set(options.memoryStore.exportPersisted().map((e) => e.content));
    const newMems = memories.filter((m) => !existingContents.has(m));
    for (const mem of newMems) {
      options.memoryStore.add(mem, "auto-dream", 0.6);
    }
    changedCount = newMems.length;
  }

  if (changedCount > 0) {
    options.memoryStore.compactPersisted(options.memoryMaxEntries);
    await options.memoryStore.saveToDisk();
  }

  return changedCount;
}
