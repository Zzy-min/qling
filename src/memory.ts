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
import { SemanticMemoryIndex } from "./memory/semantic-index.js";
import { EmbeddingClient } from "./memory/embedding.js";

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
  
  // v0.3 语义索引
  private semanticIndex: SemanticMemoryIndex | null = null;
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
      onCheckpoint: async (entries) => this.syncSemanticIndex(entries),
    }, {
      intervalMs: options.intervalMs,
      maxPendingEntries: options.maxPendingEntries,
    });
  }

  setSemanticIndex(index: SemanticMemoryIndex, client: EmbeddingClient): void {
    this.semanticIndex = index;
    this.embeddingClient = client;
  }

  async init(): Promise<void> {
    await fs.mkdir(this.memoryDir, { recursive: true });
    await this.loadFromDisk();
    if (this.semanticIndex) {
      await this.semanticIndex.init();
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
    if (this.semanticIndex) {
      this.semanticIndex.delete(id);
    }
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
        if (this.semanticIndex) {
          this.semanticIndex.delete(data.id);
        }
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
    
    // 1. 关键词检索 (同步部分)
    const keywordResults = this.entries.map((e) => {
      let score = e.importance;
      const ageHours = (now - e.createdAt) / (1000 * 60 * 60);
      score *= Math.pow(0.9, ageHours / 24);
      const keywords = query.toLowerCase().split(/\s+/);
      const content = e.content.toLowerCase();
      const matches = keywords.filter((k) => content.includes(k)).length;
      score += matches * 0.1;
      return { entry: e, score };
    });

    // 2. 语义检索 (异步)
    let semanticResults: { entry: PersistedEntry, score: number }[] = [];
    if (this.semanticIndex && this.embeddingClient && query.trim()) {
      try {
        const queryVector = await this.embeddingClient.getEmbedding(query);
        const searchHits = this.semanticIndex.search(queryVector, limit * 2);
        semanticResults = searchHits.map(h => ({
          entry: h.entry,
          score: h.score * 0.8 // 降低语义原始分权重，便于混合
        }));
      } catch (err) {
        console.error(`[PersistedMemory] Semantic search failed, falling back to keywords: ${(err as Error).message}`);
      }
    }

    // 3. 混合排序 (Hybrid Rerank)
    const merged = new Map<string, { entry: PersistedEntry, score: number }>();
    
    // 注入关键词分
    keywordResults.forEach(r => merged.set(r.entry.id, r));
    
    // 注入或叠加语义分
    semanticResults.forEach(r => {
      const existing = merged.get(r.entry.id);
      if (existing) {
        existing.score += r.score; // 叠加
      } else {
        merged.set(r.entry.id, r);
      }
    });

    return Array.from(merged.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.entry);
  }

  async syncSemanticIndex(entries: PersistedEntry[]): Promise<void> {
    if (!this.semanticIndex || !this.embeddingClient) return;

    // 增量同步逻辑：找出尚未在向量索引中的条目
    // 简单起见，这里假设 entries 是全量，实际 ProjectionWorker 会传入合并后的 PersistedMemory.entries
    // 我们只处理没有被索引的新条目（需要一种方式记录已索引状态，暂时用 content 匹配或直接让 semanticIndex 决定）
    // 为了性能，我们只取最近 replayed 的或者简单的全量 diff
    
    // 这里实现一个简单的逻辑：如果索引为空，则全量重建；否则增量处理
    // (实际应用中应在 SemanticMemoryIndex 记录 last_indexed_at)
    
    // 先做最小可行实现：批量处理
    const batchSize = 10;
    const entriesToIndex = entries.slice(-batchSize); // 仅处理最近 10 条作为示例
    try {
      const vectors = await this.embeddingClient.getEmbeddings(entriesToIndex.map(e => e.content));
      for (let i = 0; i < entriesToIndex.length; i++) {
        this.semanticIndex.upsert(entriesToIndex[i], vectors[i]);
      }
    } catch (err) {
      console.error(`[PersistedMemory] Async semantic indexing failed: ${(err as Error).message}`);
    }
  }

  async rebuildSemanticIndex(): Promise<void> {
    if (!this.semanticIndex || !this.embeddingClient) return;
    this.semanticIndex.clear();
    const batchSize = 10;
    for (let i = 0; i < this.entries.length; i += batchSize) {
      const batch = this.entries.slice(i, i + batchSize);
      const vectors = await this.embeddingClient.getEmbeddings(batch.map(e => e.content));
      for (let j = 0; j < batch.length; j++) {
        this.semanticIndex.upsert(batch[j], vectors[j]);
      }
    }
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
      // WAL 模式：写入 WAL 条目，由 ProjectionWorker 异步投影
      await this.wal.append("compact", this.entries);
    } else {
      // 传统模式：直接写 memory.json
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
  private persisted: PersistedMemory;
  private scratchpad: ScratchpadMemory;
  private conversation: ConversationMemory;
  private config: typeof DEFAULT_CONFIG;

  constructor(memoryDir: string, config: Partial<typeof DEFAULT_CONFIG> = {}) {
    this.persisted = new PersistedMemory(memoryDir);
    this.scratchpad = new ScratchpadMemory();
    this.conversation = new ConversationMemory();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async init(): Promise<void> {
    await this.persisted.init();
  }

  setWAL(
    wal: WriteAheadLog,
    options: { intervalMs?: number; maxPendingEntries?: number } = {}
  ): void {
    this.persisted.setWAL(wal, options);
  }

  setSemanticIndex(index: SemanticMemoryIndex, client: EmbeddingClient): void {
    this.persisted.setSemanticIndex(index, client);
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

  async rebuildSemanticIndex(): Promise<void> {
    await this.persisted.rebuildSemanticIndex();
  }

  // --- Persisted（对外 API）---
  add(content: string, source: string, importance: number = 0.5): void {
    this.persisted.add(content, source, importance);
  }

  async getRelevant(query: string, limit: number = 5): Promise<PersistedEntry[]> {
    return this.persisted.getRelevant(query, limit);
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
    if (parts.length === 0) return null;
    return parts.join("\n\n");
  }

  // --- 统一接口：保存到磁盘 ---
  async saveToDisk(): Promise<void> {
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
    /(?:记住|记得|重要|不要忘记)[：:](.+)/gi,
    /(?:项目|技术栈|框架)[：:](\S+)/gi,
    /(?:工作目录)[：:](\S+)/gi,
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

// --- Token Budget Manager（7.3 节）---

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
    return "Token 预算即将耗尽（剩余 " + pct + "%），请精简回复，减少工具调用。";
  }

  estimateMessagesCost(messages: { content: string }[]): number {
    return messages.reduce((sum, m) => sum + m.content.length * 4, 0);
  }
}
