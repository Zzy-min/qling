// ============================================================
// 轻灵 - Memory 系统 v3（WAL + 投影 Worker + LLM Dream）
// 三层架构：Scratchpad（会话）→ Conversation（对话）→ Persisted（持久化）
// ============================================================

import * as fs from "fs/promises";
import * as path from "path";
import type { PersistedEntry } from "./types.js";
import { WriteAheadLog } from "./memory/wal.js";
import type { WALEntry } from "./types.js";
import { ProjectionWorker } from "./memory/projection-worker.js";
import { MemoryCompactor } from "./memory/compactor.js";
import { CognitiveIndex } from "./memory/cognitive-index.js";
import { EmbeddingClient } from "./memory/embedding.js";
import * as crypto from "crypto";
import type { MemoryOperation } from "./memory/consolidation.js";

const DEFAULT_CONFIG = {
  enabled: true,
  turnThreshold: 24,
  transcriptWindow: 4,
  semanticEnabled: false,
};

// --- PersistedMemory（长期存储，WAL 模式可选）---

export class PersistedMemory {
  entries: PersistedEntry[] = [];
  private memoryDir: string;
  private wal: WriteAheadLog | null = null;
  private projectionWorker: ProjectionWorker | null = null;

  // v0.5 认知引擎
  private cognitiveIndex: CognitiveIndex | null = null;
  private embeddingClient: EmbeddingClient | null = null;

  constructor(memoryDir: string) {
    this.memoryDir = memoryDir;
  }

  setWAL(
    wal: WriteAheadLog,
    options: { intervalMs?: number; maxPendingEntries?: number } = {}
  ): void {
    this.wal = wal;
    this.projectionWorker = new ProjectionWorker(wal, {
      applyEntry: (entry) => this.applyWALEntry(entry),
      getEntries: () => this.entries,
      onCheckpoint: async (entries) => this.syncCognitiveIndex(entries),
    }, {
      intervalMs: options.intervalMs,
      maxPendingEntries: options.maxPendingEntries,
    });
  }

  setCognitiveIndex(index: CognitiveIndex, client: EmbeddingClient): void {
    this.cognitiveIndex = index;
    this.embeddingClient = client;
  }

  async init(): Promise<void> {
    await fs.mkdir(this.memoryDir, { recursive: true });
    await this.loadFromDisk();
    if (this.cognitiveIndex) {
      await this.cognitiveIndex.init();
    }
  }

  add(content: string, source: string, importance: number = 0.5): void {
    const entry: PersistedEntry = {
      id: "mem_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      content,
      source,
      createdAt: Date.now(),
      importance,
    };
    this.entries.push(entry);
    this.entries.sort((a, b) => b.importance - a.importance);
  }

  remove(id: string): boolean {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx === -1) return false;
    this.entries.splice(idx, 1);
    return true;
  }

  update(id: string, updates: Partial<Pick<PersistedEntry, "content" | "importance">>): boolean {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return false;
    if (updates.content !== undefined) entry.content = updates.content;
    if (updates.importance !== undefined) entry.importance = updates.importance;
    this.entries.sort((a, b) => b.importance - a.importance);
    return true;
  }

  applyWALEntry(entry: WALEntry): void {
    switch (entry.op) {
      case "add": {
        const data = entry.data as PersistedEntry;
        if (!this.entries.some((e) => e.id === data.id)) {
          this.entries.push(data);
          this.entries.sort((a, b) => b.importance - a.importance);
        }
        break;
      }
      case "remove": {
        const data = entry.data as { id: string };
        this.entries = this.entries.filter((e) => e.id !== data.id);
        break;
      }
      case "update": {
        const data = entry.data as PersistedEntry;
        const existing = this.entries.find((e) => e.id === data.id);
        if (existing) {
          if (data.content !== undefined) existing.content = data.content;
          if (data.importance !== undefined) existing.importance = data.importance;
        }
        break;
      }
      case "compact": {
        const data = entry.data as PersistedEntry[];
        this.entries = data;
        break;
      }
    }
  }

  async getRelevant(query: string, limit: number = 5): Promise<PersistedEntry[]> {
    const now = Date.now();

    // 1. 关键词检索
    const keywordResults = this.entries.map((e) => {
      let score = e.importance;
      const ageHours = (now - e.createdAt) / (1000 * 60 * 60);
      score *= Math.pow(0.9, ageHours / 24);
      const keywords = query.toLowerCase().split(/\s+/);
      const content = e.content.toLowerCase();
      const matches = keywords.filter((k) => content.includes(k)).length;
      score += matches * 0.1;
      return { entry: e, score, source: "keyword" as const };
    });

    // 2. 向量检索 (v0.3+)
    let semanticResults: { entry: PersistedEntry, score: number, source: "vector" }[] = [];
    if (this.cognitiveIndex && this.embeddingClient && query.trim()) {
      try {
        const queryVector = await this.embeddingClient.getEmbedding(query);
        const searchHits = this.cognitiveIndex.searchVector(queryVector, limit * 2);
        semanticResults = searchHits.map(h => ({
          entry: h.entry,
          score: h.score * 0.8,
          source: "vector" as const
        }));
      } catch (err: any) {
        // 专项修复：处理 404 (Endpoint 不支持)
        if (err.message.includes("404")) {
           if (!(this as any)._warned404) {
             console.warn(`[Memory] ⚠️ 当前提供商不支持 Embedding 接口 (404)，已降级为纯关键词检索模式。`);
             (this as any)._warned404 = true;
           }
        } else {
           console.error(`[PersistedMemory] Vector search failed: ${err.message}`);
        }
      }
    }

    // 3. 经验检索 (v0.5 M1)
    const practices = this.cognitiveIndex?.getRelatedPractices(query) || [];
    const practiceResults = practices.map(p => ({
      id: p.id,
      content: `[最佳实践] 任务模式: ${p.task_pattern} | 成功路径: ${JSON.parse(p.action_json).join(" -> ")}`,
      source: "practice",
      importance: p.confidence,
      createdAt: p.created_at
    }));

    // 4. 混合排序 (Hybrid Rerank)
    const merged = new Map<string, { entry: any, score: number }>();
    keywordResults.forEach(r => merged.set(r.entry.id, r));
    semanticResults.forEach(r => {
      const existing = merged.get(r.entry.id);
      if (existing) existing.score += r.score;
      else merged.set(r.entry.id, r);
    });

    practiceResults.forEach(p => {
       merged.set(p.id, { entry: p, score: 2.0 });
    });

    return Array.from(merged.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.entry);
  }

  async syncCognitiveIndex(entries: PersistedEntry[]): Promise<void> {
    if (!this.cognitiveIndex || !this.embeddingClient) return;
    const batchSize = 10;
    const entriesToIndex = entries.slice(-batchSize);
    try {
      const vectors = await this.embeddingClient.getEmbeddings(entriesToIndex.map(e => e.content));
      for (let i = 0; i < entriesToIndex.length; i++) {
        this.cognitiveIndex.upsertVector(entriesToIndex[i], vectors[i]);
      }
    } catch (err: any) {
      const msg = err.message || String(err);
      if (msg.includes("404")) {
        if (!(this as any)._semanticWarned404) {
          console.warn(`[Memory] ⚠️ 当前提供商不支持 Embedding 接口 (404)，已禁用语义索引（降级为关键词+实践检索）。请为语义记忆配置支持 embeddings 的 provider（如 OpenAI）或设置 QLING_MEMORY_SEMANTIC_ENDPOINT / _MODEL。`);
          (this as any)._semanticWarned404 = true;
          // 禁用后续索引
          this.embeddingClient = null;
        }
      } else {
        console.error(`[PersistedMemory] Async cognitive indexing failed: ${msg}`);
      }
    }
  }

  /** 建立知识关联 */
  link(source: any, relation: string, target: any): void {
    this.cognitiveIndex?.link(source, relation, target);
  }

  linkSessionToEntities(sessionId: string, summary: string, files: string[], tasks: string[]): void {
    this.cognitiveIndex?.linkSessionToEntities(sessionId, summary, files, tasks);
  }

  /** 记录最佳实践 */
  addPractice(pattern: string, commands: string[], files: string[], confidence: number = 1.0): void {
    this.cognitiveIndex?.addPractice({
      id: "prac_" + Date.now(),
      task_pattern: pattern,
      successful_commands: commands,
      files_involved: files,
      confidence,
    });
  }

  formatForPrompt(limit: number = 10): string {
    if (this.entries.length === 0) return "";
    const relevant = this.getRelevantSync("", limit);
    if (relevant.length === 0) return "";
    return relevant
      .map((e) => "[" + e.source + "] " + e.content)
      .join("\n");
  }

  private getRelevantSync(query: string, limit: number = 5): PersistedEntry[] {
    const now = Date.now();
    const scored = this.entries.map((e) => {
      let score = e.importance;
      const ageHours = (now - e.createdAt) / (1000 * 60 * 60);
      score *= Math.pow(0.9, ageHours / 24);
      const keywords = query.toLowerCase().split(/\s+/);
      const content = e.content.toLowerCase();
      const matches = keywords.filter((k) => content.includes(k)).length;
      score += matches * 0.1;
      return { entry: e, score };
    });
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.entry);
  }

  async saveToDisk(): Promise<void> {
    if (this.wal) {
      await this.wal.append("compact", this.entries);
    } else {
      const file = path.join(this.memoryDir, "memory.json");
      await fs.writeFile(file, JSON.stringify(this.entries, null, 2), "utf-8");
    }
  }

  async loadFromDisk(): Promise<void> {
    try {
      const file = path.join(this.memoryDir, "memory.json");
      const data = await fs.readFile(file, "utf-8");
      this.entries = JSON.parse(data);
    } catch {
      this.entries = [];
    }
  }

  merge(entries: PersistedEntry[]): void {
    const existing = new Map(this.entries.map((e) => [e.id, e]));
    for (const entry of entries) {
      existing.set(entry.id, entry);
    }
    this.entries = Array.from(existing.values());
    this.entries.sort((a, b) => b.importance - a.importance);
  }

  getAll(): PersistedEntry[] {
    return [...this.entries];
  }

  compact(maxEntries: number = 1000): void {
    const compactor = new MemoryCompactor({ maxEntries });
    const result = compactor.compactWithEntries(this.entries);
    this.entries = result.entries;
  }

  startProjection(): void {
    this.projectionWorker?.start();
  }

  stopProjection(): void {
    this.projectionWorker?.stop();
  }

  async forceCheckpoint(): Promise<void> {
    await this.projectionWorker?.forceCheckpoint();
  }

  async rebuildSemanticIndex(): Promise<void> {
    if (!this.cognitiveIndex || !this.embeddingClient) return;
    this.cognitiveIndex.close();
    await this.cognitiveIndex.init();
    const batchSize = 10;
    for (let i = 0; i < this.entries.length; i += batchSize) {
      const batch = this.entries.slice(i, i + batchSize);
      try {
        const vectors = await this.embeddingClient.getEmbeddings(batch.map(e => e.content));
        for (let j = 0; j < batch.length; j++) {
          this.cognitiveIndex.upsertVector(batch[j], vectors[j]);
        }
      } catch (err: any) {
        console.error(`[PersistedMemory] rebuildSemanticIndex batch failed: ${err.message}`);
        break; // stop on failure
      }
    }
  }

  async shutdown(): Promise<void> {
    this.stopProjection();
    await this.forceCheckpoint();
    if (this.cognitiveIndex) {
      this.cognitiveIndex.close();
    }
  }

  getCognitiveIndex(): CognitiveIndex | null {
    return this.cognitiveIndex;
  }
}

// --- ScratchpadMemory（会话笔记，临时，Agent 自己写入读取）---

export class ScratchpadMemory {
  private notes: Map<string, string> = new Map();

  set(key: string, value: string): void {
    this.notes.set(key, value);
  }

  get(key: string): string | undefined {
    return this.notes.get(key);
  }

  has(key: string): boolean {
    return this.notes.has(key);
  }

  delete(key: string): void {
    this.notes.delete(key);
  }

  entries(): IterableIterator<[string, string]> {
    return this.notes.entries();
  }

  formatForPrompt(): string {
    if (this.notes.size === 0) return "";
    const lines = Array.from(this.notes.entries()).map(([k, v]) => "- " + k + ": " + v);
    return "[会话笔记]\n" + lines.join("\n");
  }

  clear(): void {
    this.notes.clear();
  }
}

// --- ConversationMemory（对话级记忆，当前会话）---

interface ConversationTurn {
  role: string;
  content: string;
  timestamp: number;
}

export class ConversationMemory {
  private turns: ConversationTurn[] = [];

  add(role: string, content: string): void {
    this.turns.push({ role, content, timestamp: Date.now() });
  }

  getRecent(count: number = 10): ConversationTurn[] {
    return this.turns.slice(-count);
  }

  getAll(): ConversationTurn[] {
    return [...this.turns];
  }

  count(): number {
    return this.turns.length;
  }

  clear(): void {
    this.turns = [];
  }

  extractKeyInfo(): string[] {
    const recent = this.turns.slice(-8);
    const lines: string[] = [];
    for (const t of recent) {
      const paths = t.content.match(/[/\.a-zA-Z0-9_-]+\.(ts|js|py|md|json|yml|yaml|sh)/g);
      if (paths) lines.push(...paths);
      const techs = t.content.match(/(?:使用|调用|通过)\s+(\S+)/g);
      if (techs) lines.push(...techs);
    }
    return Array.from(new Set(lines));
  }
}

// --- Unified MemoryStore（统一入口，组合三层）---

export class MemoryStore {
  private persisted: PersistedMemory; // Workspace persisted memory (for compatibility)
  private globalPersisted: PersistedMemory;
  private scratchpad: ScratchpadMemory;
  private conversation: ConversationMemory;
  private config: typeof DEFAULT_CONFIG;
  private workspaceMemoryDir: string;
  private globalMemoryDir: string;

  constructor(memoryDir: string, config: Partial<typeof DEFAULT_CONFIG> & { workspaceDir?: string } = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    const workspaceDir = config.workspaceDir || process.cwd();
    const wsHash = crypto.createHash("sha256").update(path.resolve(workspaceDir)).digest("hex").slice(0, 16);

    // If memoryDir ends with "memory", assume it is the runtime root memory directory.
    const parentDir = memoryDir.endsWith("memory") ? memoryDir : path.join(path.dirname(memoryDir), "memory");
    this.globalMemoryDir = path.join(parentDir, "global");
    this.workspaceMemoryDir = path.join(parentDir, "workspace", wsHash);

    this.persisted = new PersistedMemory(this.workspaceMemoryDir);
    this.globalPersisted = new PersistedMemory(this.globalMemoryDir);
    this.scratchpad = new ScratchpadMemory();
    this.conversation = new ConversationMemory();
  }

  async init(): Promise<void> {
    await this.globalPersisted.init();
    await this.persisted.init();
  }

  setWAL(
    wal: WriteAheadLog,
    options: { intervalMs?: number; maxPendingEntries?: number } = {}
  ): void {
    this.persisted.setWAL(wal, options);
  }

  setCognitiveIndex(index: CognitiveIndex, client: EmbeddingClient): void {
    this.persisted.setCognitiveIndex(index, client);
  }

  startProjection(): void {
    this.persisted.startProjection();
  }

  stopProjection(): void {
    this.persisted.stopProjection();
  }

  async forceCheckpoint(): Promise<void> {
    await this.persisted.forceCheckpoint();
  }

  async shutdown(): Promise<void> {
    await this.globalPersisted.shutdown();
    await this.persisted.shutdown();
  }

  async rebuildSemanticIndex(): Promise<void> {
    await this.persisted.rebuildSemanticIndex();
  }

  getCognitiveIndex(): CognitiveIndex | null {
    return this.persisted.getCognitiveIndex();
  }

  // --- Persisted（对外 API）---
  add(content: string, source: string, importance: number = 0.5, scope: "global" | "workspace" = "workspace"): void {
    if (scope === "global") {
      this.globalPersisted.add(content, source, importance);
    } else {
      this.persisted.add(content, source, importance);
    }
  }

  remove(id: string, scope: "global" | "workspace" = "workspace"): boolean {
    if (scope === "global") {
      return this.globalPersisted.remove(id);
    } else {
      return this.persisted.remove(id);
    }
  }

  update(id: string, updates: Partial<Pick<PersistedEntry, "content" | "importance">>, scope: "global" | "workspace" = "workspace"): boolean {
    if (scope === "global") {
      return this.globalPersisted.update(id, updates);
    } else {
      return this.persisted.update(id, updates);
    }
  }

  applyOperations(ops: MemoryOperation[], scope: "global" | "workspace" = "workspace"): void {
    for (const op of ops) {
      switch (op.action) {
        case "ADD":
          this.add(op.fact, "dream-consolidation", 0.6, scope);
          break;
        case "UPDATE":
          if (op.targetId) {
            this.update(op.targetId, { content: op.fact }, scope);
          }
          break;
        case "DELETE":
          if (op.targetId) {
            this.remove(op.targetId, scope);
          }
          break;
      }
    }
  }

  async getRelevant(query: string, limit: number = 5): Promise<PersistedEntry[]> {
    const wsHits = await this.persisted.getRelevant(query, limit);
    const globalHits = await this.globalPersisted.getRelevant(query, limit);

    const merged = new Map<string, { entry: PersistedEntry; score: number }>();

    // Project/workspace memories get a weight multiplier of 1.0
    wsHits.forEach((entry, idx) => {
      const score = (limit - idx) * 1.0;
      merged.set("ws:" + entry.id, { entry, score });
    });

    // Global memories get a weight multiplier of 0.7
    globalHits.forEach((entry, idx) => {
      const score = (limit - idx) * 0.7;
      const key = "global:" + entry.id;
      merged.set(key, { entry, score });
    });

    return Array.from(merged.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.entry);
  }

  // --- Cognitive Layer (M1) ---
  link(source: any, relation: string, target: any): void {
    this.persisted.link(source, relation, target);
  }

  linkSessionToEntities(sessionId: string, summary: string, files: string[], tasks: string[]): void {
    this.persisted.linkSessionToEntities(sessionId, summary, files, tasks);
  }

  addPractice(pattern: string, commands: string[], files: string[]): void {
    this.persisted.addPractice(pattern, commands, files);
  }

  // --- Scratchpad（对外 API）---
  setNote(key: string, value: string): void {
    this.scratchpad.set(key, value);
  }

  getNote(key: string): string | undefined {
    return this.scratchpad.get(key);
  }

  deleteNote(key: string): void {
    this.scratchpad.delete(key);
  }

  // --- Conversation（对外 API）---
  addConversationTurn(role: string, content: string): void {
    this.conversation.add(role, content);
  }

  getConversationCount(): number {
    return this.conversation.count();
  }

  // --- Scratchpad → Persisted（笔记提升为持久记忆）---
  promoteNoteToMemory(key: string, importance: number = 0.6): boolean {
    const value = this.scratchpad.get(key);
    if (!value) return false;
    this.persisted.add("[笔记->记忆] " + key + ": " + value, "manual", importance);
    this.scratchpad.delete(key);
    return true;
  }

  // --- 统一接口：格式化提示字符串 ---
  formatPromptForContext(limit: number = 10): string | null {
    const parts: string[] = [];
    const scratchpadStr = this.scratchpad.formatForPrompt();
    if (scratchpadStr) parts.push(scratchpadStr);
    const persistedStr = this.persisted.formatForPrompt(limit);
    if (persistedStr) parts.push(persistedStr);
    const globalStr = this.globalPersisted.formatForPrompt(limit);
    if (globalStr) parts.push("[全局记忆]\n" + globalStr);
    if (parts.length === 0) return null;
    return parts.join("\n\n");
  }

  // --- 统一接口：保存到磁盘 ---
  async saveToDisk(): Promise<void> {
    await this.globalPersisted.saveToDisk();
    await this.persisted.saveToDisk();
  }

  // --- 会话重置（不清持久化）---
  resetSession(): void {
    this.scratchpad.clear();
    this.conversation.clear();
  }

  // --- 全量导出（用于压缩合并）---
  exportPersisted(): PersistedEntry[] {
    return this.persisted.getAll();
  }

  // --- 全量导入（用于压缩合并后恢复）---
  importPersisted(entries: PersistedEntry[]): void {
    this.persisted.merge(entries);
  }

  compactPersisted(maxEntries: number): void {
    this.persisted.compact(maxEntries);
  }

  getWorkspaceMemoryDir(): string {
    return this.workspaceMemoryDir;
  }

  getGlobalMemoryDir(): string {
    return this.globalMemoryDir;
  }
}

// --- extractDreamMemories（AutoDream 提取记忆）---

interface DreamContext {
  turnCount: number;
  transcript: string[];
}

interface DreamConfig {
  enabled: boolean;
  turnThreshold: number;
  transcriptWindow?: number;
}

export async function extractDreamMemories(
  ctx: DreamContext,
  config: DreamConfig
): Promise<string[]> {
  if (ctx.turnCount < config.turnThreshold) return [];

  const recent = ctx.transcript.slice(-(config.transcriptWindow ?? 4));
  const combined = recent.join("\n---\n");

  const patterns = [
    /(?:记住|记得|重要|不要忘记)[：:]\s*(.+)/gi,
    /(?:项目|技术栈|框架)[：:]\s*(\S+)/gi,
    /(?:工作目录)[：:]\s*(\S+)/gi,
    /(?:使用|调用)[：:]\s*(\S+)/gi,
    /([/\.a-zA-Z0-9_-]+\.(?:ts|js|py|md|json|yml|yaml|sh))/g,
  ];

  const memories: string[] = [];
  for (const pat of patterns) {
    let match;
    while ((match = pat.exec(combined)) !== null) {
      memories.push(match[1].trim());
    }
  }

  return Array.from(new Set(memories));
}

// --- Token Budget Manager ---

export class TokenBudgetManager {
  maxTokens: number;
  nudgeThreshold: number;
  usedTokens: number;

  constructor(maxTokens: number, nudgeThreshold: number = 0.2, usedTokens: number = 0) {
    this.maxTokens = maxTokens;
    this.nudgeThreshold = nudgeThreshold;
    this.usedTokens = usedTokens;
  }

  addUsage(tokens: number): void {
    this.usedTokens += tokens;
  }

  syncUsage(actualTokens: number): void {
    this.usedTokens = actualTokens;
  }

  reset(): void {
    this.usedTokens = 0;
  }

  getRemaining(): number {
    return this.maxTokens - this.usedTokens;
  }

  getRemainingPct(): number {
    return this.getRemaining() / this.maxTokens;
  }

  shouldNudge(): boolean {
    return this.getRemainingPct() < this.nudgeThreshold;
  }

  buildNudgeMessage(): string {
    const pct = Math.round(this.getRemainingPct() * 100);
    return "Token 预算即将耗尽（剩余 " + pct + "%），请精简回复，减少工具调用频率。";
  }

  estimateMessagesCost(messages: { content: string }[]): number {
    return messages.reduce((sum, m) => sum + m.content.length * 4, 0);
  }
}
