import * as fs from "fs/promises";
import { existsSync } from "fs";
import * as path from "path";

import type { Message } from "../types.js";

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
}

export interface SavedSessionSummary {
  name: string;
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
  return {
    name: snapshot.name,
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
    await fs.writeFile(filePath, JSON.stringify(normalized, null, 2), "utf-8");
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
    };
  }

  private async readSnapshot(filePath: string): Promise<SavedSessionSnapshot | null> {
    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const raw = JSON.parse(await fs.readFile(filePath, "utf-8")) as Record<string, unknown>;
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
      };
    } catch {
      return null;
    }
  }
}
