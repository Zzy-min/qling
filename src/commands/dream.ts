import { extractDreamMemories } from "../memory.js";
import type { Message } from "../types.js";
import type { SlashCommandContext } from "./runtime.js";
import { SlashCommand } from "./types.js";

function parseCount(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 4;
  return Math.min(Math.floor(parsed), 20);
}

function getConversationMessages(context: SlashCommandContext): Message[] {
  const agentLoop = context.agentLoop as any;
  if (typeof agentLoop.getMessagesSnapshot !== "function") return [];
  const messages = agentLoop.getMessagesSnapshot();
  if (!Array.isArray(messages)) return [];
  return messages.filter((message: Message) => message.role === "user" || message.role === "assistant");
}

export const dreamCommand: SlashCommand = {
  name: "/dream",
  aliases: ["/记梦", "/沉淀"],
  description: "将当前会话中的关键信息沉淀到本地记忆",
  usage: "/dream [count]",
  execute: async (args, context) => {
    const agentLoop = context.agentLoop as any;
    const memoryStore = typeof agentLoop.getMemoryStore === "function" ? agentLoop.getMemoryStore() : null;
    if (!memoryStore || typeof memoryStore.add !== "function" || typeof memoryStore.saveToDisk !== "function") {
      context.writeError("当前会话不支持本地 dream 写入。");
      return;
    }

    const count = parseCount(args[0]);
    const messages = getConversationMessages(context);
    const transcript = messages.map((message) => message.content);
    const memories = await extractDreamMemories(
      { turnCount: Math.max(transcript.length, count), transcript },
      { enabled: true, turnThreshold: 1, transcriptWindow: count }
    );

    if (memories.length === 0) {
      context.writeLine("dream: 没有新的本地记忆候选；未写入、不调用模型、不联网。");
      return;
    }

    for (const memory of memories) {
      memoryStore.add(memory, "manual-dream", 0.7);
    }
    if (typeof memoryStore.compactPersisted === "function") {
      memoryStore.compactPersisted(1000);
    }
    await memoryStore.saveToDisk();

    context.writeLine(`dream: 已沉淀 ${memories.length} 条本地记忆。`);
    context.writeLine("边界: 未输出记忆正文；只读取当前 user/assistant 消息；不调用模型、不联网。");
  },
};
