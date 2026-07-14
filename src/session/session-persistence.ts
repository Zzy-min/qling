// ============================================================
// Session 快照构建 / 应用（从 AgentLoop 抽出）
// domain 层：纯数据结构，不依赖 AgentLoop 实例
// ============================================================

import type { Message } from "../types.js";
import type { SavedSessionSnapshot, SavedSessionSummary } from "./session-registry.js";

export interface SessionLiveFields {
  sessionId: string;
  sessionCreatedAt: string;
  messages: Message[];
  turnCount: number;
  sessionTokens: number;
  compactionCount: number;
  workspaceDir: string | null;
}

/** Fields AgentLoop should write back after restore. */
export interface SessionRestorePatch {
  messages: Message[];
  turnCount: number;
  sessionTokens: number;
  sessionPromptTokens: number;
  sessionCompletionTokens: number;
  tokenUsageSource: "provider" | "unknown";
  compactionCount: number;
  sessionId: string;
  sessionCreatedAt: string;
  workspaceDir: string | null;
  summary: SavedSessionSummary;
}

export function buildSessionSnapshot(
  name: string,
  fields: SessionLiveFields
): Omit<SavedSessionSnapshot, "version"> {
  return {
    name,
    sessionId: fields.sessionId,
    workspaceDir: fields.workspaceDir,
    createdAt: fields.sessionCreatedAt,
    updatedAt: new Date().toISOString(),
    messages: fields.messages.map((message) => ({ ...message })),
    turnCount: fields.turnCount,
    sessionTokens: fields.sessionTokens,
    compactionCount: fields.compactionCount,
  };
}

export function applySessionSnapshot(snapshot: SavedSessionSnapshot): SessionRestorePatch {
  return {
    messages: snapshot.messages.map((message) => ({ ...message })),
    turnCount: snapshot.turnCount,
    sessionTokens: snapshot.sessionTokens,
    sessionPromptTokens: 0,
    sessionCompletionTokens: 0,
    tokenUsageSource: "unknown",
    compactionCount: snapshot.compactionCount,
    sessionId: snapshot.sessionId,
    sessionCreatedAt: snapshot.createdAt,
    workspaceDir: snapshot.workspaceDir,
    summary: {
      name: snapshot.name,
      sessionId: snapshot.sessionId,
      workspaceDir: snapshot.workspaceDir,
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
      turnCount: snapshot.turnCount,
      messageCount: snapshot.messages.length,
      sessionTokens: snapshot.sessionTokens,
      compactionCount: snapshot.compactionCount,
    },
  };
}

export function defaultSessionSaveName(now = new Date()): string {
  return "session-" + now.toISOString().replace(/[:.]/g, "-");
}
