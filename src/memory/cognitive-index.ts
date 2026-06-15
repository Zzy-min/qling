// ============================================================
// 轻灵 - Cognitive Index (v0.5)
// 结合向量、图谱与经验蒸馏的综合认知引擎
// ============================================================

import Database from "better-sqlite3";
import * as path from "path";
import * as fs from "fs/promises";
import { existsSync } from "fs";
import type { PersistedEntry } from "../types.js";

export interface SemanticSearchResult {
  entry: PersistedEntry;
  score: number;
  source: "vector" | "keyword" | "graph" | "practice";
}

export interface distilledPractice {
  id: string;
  task_pattern: string;
  successful_commands: string[];
  files_involved: string[];
  confidence: number;
}

export class CognitiveIndex {
  private db!: Database.Database;
  private dbPath: string;

  constructor(memoryDir: string) {
    this.dbPath = path.join(memoryDir, "cognitive_knowledge.db");
  }

  async init(): Promise<void> {
    const dir = path.dirname(this.dbPath);
    if (!existsSync(dir)) {
      await fs.mkdir(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");

    // 1. 向量存储表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS embeddings (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        vector BLOB NOT NULL,
        metadata TEXT,
        created_at INTEGER NOT NULL
      )
    `);

    // 2. 知识图谱表 (Entity-Relation-Entity)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kg_nodes (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL, -- task, file, command, technology
        label TEXT NOT NULL,
        metadata TEXT,
        last_seen INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS kg_edges (
        source TEXT NOT NULL,
        target TEXT NOT NULL,
        relation TEXT NOT NULL, -- uses, writes, reads, part_of
        weight REAL DEFAULT 1.0,
        PRIMARY KEY (source, target, relation)
      );
    `);

    // 3. 经验蒸馏表 (Best Practices)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS distilled_practices (
        id TEXT PRIMARY KEY,
        task_pattern TEXT UNIQUE NOT NULL,
        action_json TEXT NOT NULL, -- 成功执行的指令序列
        context_json TEXT NOT NULL, -- 涉及的文件与前置条件
        confidence REAL DEFAULT 1.0,
        hit_count INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL
      )
    `);

    // Ensure existing tables enforce the unique index on task_pattern
    try {
      this.db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_distilled_practices_task_pattern ON distilled_practices(task_pattern);
      `);
    } catch (err) {
      console.warn("[CognitiveIndex] Failed to create unique index, attempting deduplication:", (err as Error).message);
      try {
        this.db.exec(`
          DELETE FROM distilled_practices
          WHERE id NOT IN (
            SELECT MIN(id) FROM distilled_practices GROUP BY task_pattern
          );
        `);
        this.db.exec(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_distilled_practices_task_pattern ON distilled_practices(task_pattern);
        `);
      } catch (dedupErr) {
        console.error("[CognitiveIndex] Deduplication and index migration failed:", (dedupErr as Error).message);
      }
    }
  }

  // --- 向量操作 ---

  upsertVector(entry: PersistedEntry, vector: number[]): void {
    const vectorBuffer = Buffer.from(new Float32Array(vector).buffer);
    const stmt = this.db.prepare(`
      INSERT INTO embeddings (id, content, vector, metadata, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        content = excluded.content,
        vector = excluded.vector,
        metadata = excluded.metadata
    `);
    stmt.run(
      entry.id,
      entry.content,
      vectorBuffer,
      JSON.stringify({ source: entry.source, importance: entry.importance }),
      entry.createdAt
    );
  }

  searchVector(queryVector: number[], limit: number = 10): SemanticSearchResult[] {
    const all = this.db.prepare("SELECT * FROM embeddings").all() as any[];
    const results: SemanticSearchResult[] = [];

    for (const row of all) {
      const vector = Array.from(new Float32Array(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength / 4));
      const score = this.cosineSimilarity(queryVector, vector);
      const metadata = JSON.parse(row.metadata || "{}");
      results.push({
        entry: {
          id: row.id,
          content: row.content,
          source: metadata.source || "unknown",
          importance: metadata.importance || 0.5,
          createdAt: row.created_at,
        },
        score,
        source: "vector",
      });
    }
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  // --- 知识图谱操作 ---

  link(source: { id: string, type: string, label: string }, relation: string, target: { id: string, type: string, label: string }): void {
    const upsertNode = this.db.prepare(`
      INSERT INTO kg_nodes (id, type, label, last_seen)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen
    `);

    const upsertEdge = this.db.prepare(`
      INSERT INTO kg_edges (source, target, relation, weight)
      VALUES (?, ?, ?, 1.0)
      ON CONFLICT(source, target, relation) DO UPDATE SET weight = weight + 0.1
    `);

    const now = Date.now();
    this.db.transaction(() => {
      upsertNode.run(source.id, source.type, source.label, now);
      upsertNode.run(target.id, target.type, target.label, now);
      upsertEdge.run(source.id, target.id, relation);
    })();
  }

  // --- 经验蒸馏操作 ---

  addPractice(practice: Omit<distilledPractice, "hit_count" | "created_at">): void {
    const stmt = this.db.prepare(`
      INSERT INTO distilled_practices (id, task_pattern, action_json, context_json, confidence, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(task_pattern) DO UPDATE SET
        hit_count = hit_count + 1,
        confidence = (confidence + excluded.confidence) / 2.0
    `);
    stmt.run(
      practice.id,
      practice.task_pattern,
      JSON.stringify(practice.successful_commands),
      JSON.stringify(practice.files_involved),
      practice.confidence,
      Date.now()
    );
  }

  getRelatedPractices(query: string): any[] {
    // 简单的关键词模式匹配，后期可升级为向量检索
    return this.db.prepare(`
      SELECT * FROM distilled_practices
      WHERE task_pattern LIKE ?
      ORDER BY confidence DESC, hit_count DESC
      LIMIT 3
    `).all(`%${query}%`);
  }

  // --- 符号索引相关操作 ---
  upsertSymbolNode(fileRelativePath: string, symbol: { name: string; type: string; line: number; signature: string }): void {
    const fileId = `file:${fileRelativePath}`;
    const symbolId = `symbol:${fileRelativePath}:${symbol.name}`;
    const now = Date.now();

    const upsertNode = this.db.prepare(`
      INSERT INTO kg_nodes (id, type, label, metadata, last_seen)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        label = excluded.label,
        metadata = excluded.metadata,
        last_seen = excluded.last_seen
    `);

    const upsertEdge = this.db.prepare(`
      INSERT INTO kg_edges (source, target, relation, weight)
      VALUES (?, ?, ?, 1.0)
      ON CONFLICT(source, target, relation) DO UPDATE SET weight = weight + 0.1
    `);

    this.db.transaction(() => {
      upsertNode.run(fileId, "file", fileRelativePath, null, now);
      const meta = JSON.stringify({ kind: symbol.type, line: symbol.line, signature: symbol.signature });
      upsertNode.run(symbolId, "symbol", symbol.name, meta, now);
      upsertEdge.run(symbolId, fileId, "part_of");
    })();
  }

  getSymbolsForFile(fileRelativePath: string): { name: string; type: string; line: number; signature: string }[] {
    const fileId = `file:${fileRelativePath}`;
    const stmt = this.db.prepare(`
      SELECT n.id, n.label, n.metadata
      FROM kg_nodes n
      JOIN kg_edges e ON n.id = e.source
      WHERE e.target = ? AND e.relation = 'part_of' AND n.type = 'symbol'
    `);
    const rows = stmt.all(fileId) as any[];
    return rows.map((r) => {
      const meta = JSON.parse(r.metadata || "{}");
      return {
        name: r.label,
        type: meta.kind || "function",
        line: meta.line || 0,
        signature: meta.signature || "",
      };
    });
  }

  clearSymbolsForFile(fileRelativePath: string): void {
    const fileId = `file:${fileRelativePath}`;
    this.db.transaction(() => {
      this.db.prepare(`
        DELETE FROM kg_edges
        WHERE target = ? AND relation = 'part_of'
      `).run(fileId);
      this.db.prepare(`
        DELETE FROM kg_nodes
        WHERE id LIKE ? AND type = 'symbol'
      `).run(`symbol:${fileRelativePath}:%`);
    })();
  }

  // --- 辅助工具 ---

  private cosineSimilarity(v1: number[], v2: number[]): number {
    if (v1.length !== v2.length) return 0;
    let dotProduct = 0, normA = 0, normB = 0;
    for (let i = 0; i < v1.length; i++) {
      dotProduct += v1[i] * v2[i];
      normA += v1[i] * v1[i];
      normB += v2[i] * v2[i];
    }
    const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    return isNaN(similarity) ? 0 : similarity;
  }

  close(): void {
    this.db.close();
  }
}
