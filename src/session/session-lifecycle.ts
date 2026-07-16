// ============================================================
// 会话生命周期：rewind（回退轮次）· fork（分叉新 session）
// 纯函数 + 类型，便于单测；AgentLoop 只做状态落盘。
// ============================================================

import type { Message } from "../types.js";
import { isInternalUserNoise } from "./session-title.js";

function messageText(message: Message): string {
  if (typeof message.content === "string") return message.content;
  if (message.content == null) return "";
  try {
    return JSON.stringify(message.content);
  } catch {
    return String(message.content);
  }
}

/** 可作为「用户轮」起点的消息（过滤预算 nudge / 压缩摘要） */
export function isUserTurnStart(message: Message): boolean {
  if (message.role !== "user") return false;
  return !isInternalUserNoise(messageText(message));
}

/** 统计真实用户轮次数 */
export function countUserTurns(messages: Message[]): number {
  return messages.filter(isUserTurnStart).length;
}

export interface RewindResult {
  messages: Message[];
  /** 实际回退的用户轮数 */
  removedTurns: number;
  /** 删掉的消息条数 */
  removedMessages: number;
  /** 回退后剩余用户轮数 */
  remainingTurns: number;
}

/**
 * 回退最近 n 个真实用户轮：从第 (last-n+1) 个用户轮起点切到末尾全部删除
 * （含该轮之后的 assistant/tool/预算注入消息）。
 */
export function rewindByUserTurns(messages: Message[], turns: number): RewindResult {
  const safeTurns = Math.max(0, Math.floor(Number(turns) || 0));
  if (safeTurns <= 0 || messages.length === 0) {
    return {
      messages: [...messages],
      removedTurns: 0,
      removedMessages: 0,
      remainingTurns: countUserTurns(messages),
    };
  }

  const userStarts: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (isUserTurnStart(messages[i]!)) userStarts.push(i);
  }

  if (userStarts.length === 0) {
    return {
      messages: [...messages],
      removedTurns: 0,
      removedMessages: 0,
      remainingTurns: 0,
    };
  }

  const removeCount = Math.min(safeTurns, userStarts.length);
  const cutAt = userStarts[userStarts.length - removeCount]!;
  const next = messages.slice(0, cutAt).map((m) => ({ ...m }));

  return {
    messages: next,
    removedTurns: removeCount,
    removedMessages: messages.length - next.length,
    remainingTurns: countUserTurns(next),
  };
}

export function resolveRewindTurns(args: string[] | undefined, fallback = 1): number {
  const raw = args?.[0]?.trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, 100);
}

export function resolveForkName(args: string[] | undefined, sessionId: string): string {
  const raw = args?.join(" ").trim();
  if (!raw) return sessionId;
  // 禁止路径穿越；与 SessionRegistry.normalizeName 语义对齐
  return raw.replace(/[\\/]/g, "-").replace(/\.json$/i, "").slice(0, 80) || sessionId;
}
