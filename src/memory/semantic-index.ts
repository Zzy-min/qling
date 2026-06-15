// ============================================================
// 轻灵 - Semantic Memory Index (v0.3)
// 基于 SQLite 存储向量，支持余弦相似度检索
// ============================================================

import Database from "better-sqlite3";
import * as path from "path";
import * as fs from "fs/promises";
import { existsSync } from "fs";
import type { PersistedEntry } from "../types.js";

export interface SemanticSearchResult {
  entry: PersistedEntry;
  score: number;
}

export class SemanticMemoryIndex {
  private db!: Database.Database;
  private dbPath: string;

  constructor(memoryDir: string) {
    this.dbPath = path.join(memoryDir, "semantic_memory.db");
  }

  async init(): Promise<void> {
    const dir = path.dirname(this.dbPath);
    if (!existsSync(dir)) {
      await fs.mkdir(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS embeddings (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        vector BLOB NOT NULL,
        metadata TEXT,
        created_at INTEGER NOT NULL
      )
    `);
  }

  upsert(entry: PersistedEntry, vector: number[]): void {
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

  delete(id: string): void {
    this.db.prepare("DELETE FROM embeddings WHERE id = ?").run(id);
  }

  clear(): void {
    this.db.prepare("DELETE FROM embeddings").run();
  }

  search(queryVector: number[], limit: number = 10): SemanticSearchResult[] {
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
      });
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  private cosineSimilarity(v1: number[], v2: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
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
