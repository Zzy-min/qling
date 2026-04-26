// ============================================================
// 轻灵 - Memory 系统 v2（参考 Microsoft AI Agents for Beginners Lesson 12 & 13）
// 三层架构：Scratchpad（会话）→ Conversation（对话）→ Persisted（持久化）
// ============================================================

import * as fs from "fs/promises";
import * as path from "path";

const DEFAULT_CONFIG = {
  enabled: true,
  turnThreshold: 24,
  transcriptWindow: 4,
};

// --- Persisted Memory（长期存储，磁盘持久化）---

interface PersistedEntry {
  id: string;
  content: string;
  source: string;
  createdAt: number;
  importance: number;
}

export class PersistedMemory {
  entries: PersistedEntry[] = [];
  private memoryDir: string;

  constructor(memoryDir: string) {
    this.memoryDir = memoryDir;
  }

  async init(): Promise<void> {
    await fs.mkdir(this.memoryDir, { recursive: true });
    await this.loadFromDisk();
  }

  add(content: string, source: string, importance: number = 0.5): void {
    this.entries.push({
      id: "mem_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      content,
      source,
      createdAt: Date.now(),
      importance,
    });
    this.entries.sort((a, b) => b.importance - a.importance);
  }

  getRelevant(query: string, limit: number = 5): PersistedEntry[] {
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

  formatForPrompt(limit: number = 10): string {
    if (this.entries.length === 0) return "";
    const relevant = this.getRelevant("", limit);
    if (relevant.length === 0) return "";
    return relevant
      .map((e) => "[" + e.source + "] " + e.content)
      .join("\n");
  }

  async saveToDisk(): Promise<void> {
    const file = path.join(this.memoryDir, "memory.json");
    await fs.writeFile(file, JSON.stringify(this.entries, null, 2), "utf-8");
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

  // 批量合并（用于压缩后的持久化）
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

  // 列出所有笔记
  entries(): IterableIterator<[string, string]> {
    return this.notes.entries();
  }

  // 转为提示字符串
  formatForPrompt(): string {
    if (this.notes.size === 0) return "";
    const lines = Array.from(this.notes.entries()).map(([k, v]) => "• " + k + ": " + v);
    return "【会话笔记】\n" + lines.join("\n");
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

  // 提取关键信息（供 AutoDream 使用）
  extractKeyInfo(): string[] {
    const recent = this.turns.slice(-8);
    const lines: string[] = [];
    for (const t of recent) {
      // 提取用户提到的文件路径
      const paths = t.content.match(/[/\.a-zA-Z0-9_-]+\.(ts|js|py|md|json|yml|yaml|sh)/g);
      if (paths) lines.push(...paths);
      // 提取用户提到的工具/技术
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

  // --- Persisted（对外 API）---
  add(content: string, source: string, importance: number = 0.5): void {
    this.persisted.add(content, source, importance);
  }

  getRelevant(query: string, limit: number = 5): PersistedEntry[] {
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
    this.persisted.add("[笔记→记忆] " + key + ": " + value, "manual", importance);
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
    // 工具使用记录
    /(?:使用|调用)[：:]\s*(\S+)/gi,
    // 文件路径
    /([/\.a-zA-Z0-9_-]+\.(?:ts|js|py|md|json|yml|yaml|sh))/g,
  ];

  const memories: string[] = [];
  for (const pat of patterns) {
    let match;
    while ((match = pat.exec(combined)) !== null) {
      memories.push(match[1].trim());
    }
  }

  // 去重
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

  /** 用 API 返回的实际累计值直接同步（不累加） */
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
    return "⚠️ Token 预算即将耗尽（剩余 " + pct + "%），请精简回复，减少工具调用。";
  }

  estimateMessagesCost(messages: { content: string }[]): number {
    return messages.reduce((sum, m) => sum + m.content.length * 4, 0);
  }
}
