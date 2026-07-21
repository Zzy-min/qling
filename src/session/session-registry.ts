import * as fs from "fs/promises";
import { existsSync } from "fs";
import * as path from "path";

import type { Message } from "../types.js";
import { deriveSessionTitle } from "./session-title.js";
import type { RecoveryState } from "../execution/types.js";
import { atomicWriteJson, readJsonWithBackup } from "../persistence/atomic-json.js";

export interface SavedActiveRun {
  runId: string;
  sessionId: string;
  originalTask: string;
  startedAt: number;
}

export interface SavedSessionSnapshot {
  version: number;
  name: string;
  sessionId: string;
  workspaceDir: string | null;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
  turnCount: number;
  sessionTokens: number;
  compactionCount: number;
  activeRun?: SavedActiveRun;
  recoveryState?: RecoveryState;
}

export interface SavedSessionSummary {
  /** 文件键 / 内部名（多为 session-<id>） */
  name: string;
  /**
   * 展示标题：会话第一条真实用户问题；无则回退 name。
   * 不改变磁盘文件名，仅用于列表与切换器。
   */
  title: string;
  sessionId: string;
  workspaceDir: string | null;
  createdAt: string;
  updatedAt: string;
  turnCount: number;
  messageCount: number;
  sessionTokens: number;
  compactionCount: number;
}

export interface SessionRegistryOptions {
  stateDir: string;
}

function cloneMessages(messages: Message[]): Message[] {
  return messages.map((message) => ({ ...message }));
}

function toSummary(snapshot: SavedSessionSnapshot): SavedSessionSummary {
  const title = deriveSessionTitle(snapshot.messages) || snapshot.name;
  return {
    name: snapshot.name,
    title,
    sessionId: snapshot.sessionId,
    workspaceDir: snapshot.workspaceDir,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    turnCount: snapshot.turnCount,
    messageCount: snapshot.messages.length,
    sessionTokens: snapshot.sessionTokens,
    compactionCount: snapshot.compactionCount,
  };
}

export class SessionRegistry {
  private readonly sessionsDir: string;

  constructor(options: SessionRegistryOptions) {
    this.sessionsDir = path.join(options.stateDir, "sessions");
  }

  async save(snapshot: Omit<SavedSessionSnapshot, "version">): Promise<string> {
    await fs.mkdir(this.sessionsDir, { recursive: true });
    const normalized = this.normalizeSnapshot(snapshot);
    const filePath = this.getSnapshotPath(normalized.name);
    await atomicWriteJson(filePath, normalized, { backup: true });
    return filePath;
  }

  async list(): Promise<SavedSessionSummary[]> {
    await fs.mkdir(this.sessionsDir, { recursive: true });
    const files = await fs.readdir(this.sessionsDir);
    const snapshots: SavedSessionSummary[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const snapshot = await this.readSnapshot(path.join(this.sessionsDir, file));
      if (!snapshot) continue;
      snapshots.push(toSummary(snapshot));
    }

    return snapshots.sort((left, right) => {
      const diff = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
      if (diff !== 0) return diff;
      return right.name.localeCompare(left.name);
    });
  }

  async load(nameOrSessionId: string): Promise<SavedSessionSnapshot | null> {
    await fs.mkdir(this.sessionsDir, { recursive: true });
    const normalizedRef = this.normalizeName(nameOrSessionId);
    const directPath = this.getSnapshotPath(normalizedRef);
    const direct = await this.readSnapshot(directPath);
    if (direct) {
      return direct;
    }

    const summaries = await this.list();
    const matched = summaries.find(
      (summary) => summary.name === normalizedRef || summary.sessionId === normalizedRef
    );
    if (!matched) {
      return null;
    }
    return this.readSnapshot(this.getSnapshotPath(matched.name));
  }

  async loadLatest(): Promise<SavedSessionSnapshot | null> {
    const summaries = await this.list();
    if (summaries.length === 0) {
      return null;
    }
    return this.readSnapshot(this.getSnapshotPath(summaries[0].name));
  }

  private getSnapshotPath(name: string): string {
    return path.join(this.sessionsDir, `${this.normalizeName(name)}.json`);
  }

  private normalizeName(name: string): string {
    return path.basename(name).replace(/\.json$/i, "");
  }

  private normalizeSnapshot(snapshot: Omit<SavedSessionSnapshot, "version">): SavedSessionSnapshot {
    return {
      version: 1,
      name: this.normalizeName(snapshot.name),
      sessionId: snapshot.sessionId.trim(),
      workspaceDir: snapshot.workspaceDir ?? null,
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
      messages: cloneMessages(snapshot.messages ?? []),
      turnCount: snapshot.turnCount ?? 0,
      sessionTokens: snapshot.sessionTokens ?? 0,
      compactionCount: snapshot.compactionCount ?? 0,
      activeRun: snapshot.activeRun ? { ...snapshot.activeRun } : undefined,
      recoveryState: snapshot.recoveryState
        ? { ...snapshot.recoveryState, attemptedStrategies: [...(snapshot.recoveryState.attemptedStrategies ?? [])] }
        : undefined,
    };
  }

  private async readSnapshot(filePath: string): Promise<SavedSessionSnapshot | null> {
    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const read = await readJsonWithBackup<Record<string, unknown>>(filePath);
      if (!read) {
        console.error(`[SessionRegistry] primary and backup are unreadable: ${path.basename(filePath)}`);
        return null;
      }
      if (read.source === "backup") {
        console.warn(`[SessionRegistry] recovered ${path.basename(filePath)} from local backup`);
      }
      const raw = read.value;
      const name = this.normalizeName(path.basename(filePath));
      const savedAt = typeof raw.savedAt === "string" ? raw.savedAt : new Date(0).toISOString();
      const createdAt =
        typeof raw.createdAt === "string" ? raw.createdAt : savedAt;
      const updatedAt =
        typeof raw.updatedAt === "string" ? raw.updatedAt : savedAt;
      return {
        version: typeof raw.version === "number" ? raw.version : 1,
        name: typeof raw.name === "string" && raw.name.trim() ? this.normalizeName(raw.name) : name,
        sessionId:
          typeof raw.sessionId === "string" && raw.sessionId.trim()
            ? raw.sessionId
            : name,
        workspaceDir:
          typeof raw.workspaceDir === "string" && raw.workspaceDir.trim()
            ? raw.workspaceDir
            : null,
        createdAt,
        updatedAt,
        messages: Array.isArray(raw.messages) ? cloneMessages(raw.messages as Message[]) : [],
        turnCount: typeof raw.turnCount === "number" ? raw.turnCount : 0,
        sessionTokens: typeof raw.sessionTokens === "number" ? raw.sessionTokens : 0,
        compactionCount: typeof raw.compactionCount === "number" ? raw.compactionCount : 0,
        activeRun: raw.activeRun && typeof raw.activeRun === "object"
          ? { ...(raw.activeRun as SavedActiveRun) }
          : undefined,
        recoveryState: raw.recoveryState && typeof raw.recoveryState === "object"
          ? {
              ...(raw.recoveryState as RecoveryState),
              attemptedStrategies: Array.isArray((raw.recoveryState as RecoveryState).attemptedStrategies)
                ? [...(raw.recoveryState as RecoveryState).attemptedStrategies]
                : [],
            }
          : undefined,
      };
    } catch {
      return null;
    }
  }
}
