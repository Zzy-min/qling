import Database from "better-sqlite3";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export type MemoryCardKind = "preference" | "constraint" | "fact" | "decision" | "practice" | "failure";
export type MemoryCardScope = "global" | "workspace" | "project" | "session";
export type MemorySensitivity = "public" | "internal" | "sensitive" | "secret";

export interface MemoryCard {
  id: string;
  kind: MemoryCardKind;
  scope: MemoryCardScope;
  content: string;
  sourceEventIds: string[];
  confidence: number;
  importance: number;
  sensitivity: MemorySensitivity;
  createdAt: number;
  lastAccessedAt: number;
  expiresAt?: number;
  supersedes?: string;
}

export interface MemorySearchHit {
  card: MemoryCard;
  score: number;
  reason: string;
}

export interface MemoryCardIndexOptions {
  memoryDir: string;
  now?: () => number;
}

export function inferMemorySensitivity(content: string): MemorySensitivity {
  if (
    /\b(?:sk|api)[-_][A-Za-z0-9_-]{8,}\b/.test(content) ||
    /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b/.test(content) ||
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/.test(content) ||
    /-----BEGIN (?:(?:RSA|EC|OPENSSH|ENCRYPTED) )?PRIVATE KEY-----/.test(content) ||
    /Authorization\s*:\s*Bearer\s+\S{8,}/i.test(content) ||
    /["']?(?:[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|COOKIE|CREDENTIAL)|DATABASE_URL)["']?\s*[=:]\s*["']?[^"'\s,}<]{8,}/i.test(content) ||
    /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/i.test(content)
  ) return "secret";
  if (/\b(?:身份证|手机号|住址|private key|私钥)\b/i.test(content)) return "sensitive";
  return "internal";
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function cosine(left: number[] | null, right: number[] | null): number {
  if (!left || !right || left.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index++) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return clamp(dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm)));
}

function tokenize(value: string): Set<string> {
  const normalized = value.toLowerCase();
  const tokens = normalized.split(/[^\p{L}\p{N}_-]+/u).filter((token) => token.length >= 2);
  if (/\p{Script=Han}/u.test(normalized)) {
    for (let index = 0; index + 2 <= normalized.length; index++) {
      const gram = normalized.slice(index, index + 2);
      if (/^\p{Script=Han}{2}$/u.test(gram)) tokens.push(gram);
    }
  }
  return new Set(tokens);
}

function jaccard(left: string, right: string): number {
  const a = tokenize(left);
  const b = tokenize(right);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

export class MemoryCardIndex {
  private readonly dbPath: string;
  private readonly now: () => number;
  private db: Database.Database | null = null;
  private ftsAvailable = false;

  constructor(options: MemoryCardIndexOptions) {
    this.dbPath = path.join(options.memoryDir, "memory_cards.db");
    this.now = options.now ?? (() => Date.now());
  }

  async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.dbPath), { recursive: true });
    this.db = new Database(this.dbPath);
    await fs.chmod(this.dbPath, 0o600).catch(() => undefined);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_cards (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        scope TEXT NOT NULL,
        content TEXT NOT NULL,
        source_event_ids TEXT NOT NULL,
        confidence REAL NOT NULL,
        importance REAL NOT NULL,
        sensitivity TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL,
        expires_at INTEGER,
        supersedes TEXT,
        vector BLOB
      );
      CREATE INDEX IF NOT EXISTS idx_memory_cards_scope ON memory_cards(scope);
      CREATE INDEX IF NOT EXISTS idx_memory_cards_expiry ON memory_cards(expires_at);
    `);
    try {
      this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS memory_cards_fts USING fts5(id UNINDEXED, content);`);
      this.ftsAvailable = true;
    } catch {
      this.ftsAvailable = false;
    }
  }

  upsert(card: MemoryCard, vector?: number[]): void {
    const db = this.requireDb();
    const normalized: MemoryCard = {
      ...card,
      content: card.content.trim(),
      confidence: clamp(card.confidence),
      importance: clamp(card.importance),
      sensitivity: card.sensitivity ?? inferMemorySensitivity(card.content),
      sourceEventIds: [...new Set(card.sourceEventIds)],
    };
    const vectorBuffer = vector ? Buffer.from(new Float32Array(vector).buffer) : null;
    db.transaction(() => {
      db.prepare(`
        INSERT INTO memory_cards (
          id, kind, scope, content, source_event_ids, confidence, importance,
          sensitivity, created_at, last_accessed_at, expires_at, supersedes, vector
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          kind = excluded.kind,
          scope = excluded.scope,
          content = excluded.content,
          source_event_ids = excluded.source_event_ids,
          confidence = excluded.confidence,
          importance = excluded.importance,
          sensitivity = excluded.sensitivity,
          last_accessed_at = excluded.last_accessed_at,
          expires_at = excluded.expires_at,
          supersedes = excluded.supersedes,
          vector = COALESCE(excluded.vector, memory_cards.vector)
      `).run(
        normalized.id,
        normalized.kind,
        normalized.scope,
        normalized.content,
        JSON.stringify(normalized.sourceEventIds),
        normalized.confidence,
        normalized.importance,
        normalized.sensitivity,
        normalized.createdAt,
        normalized.lastAccessedAt,
        normalized.expiresAt ?? null,
        normalized.supersedes ?? null,
        vectorBuffer
      );
      if (this.ftsAvailable) {
        db.prepare("DELETE FROM memory_cards_fts WHERE id = ?").run(normalized.id);
        db.prepare("INSERT INTO memory_cards_fts (id, content) VALUES (?, ?)").run(normalized.id, normalized.content);
      }
    })();
  }

  remove(id: string): boolean {
    const db = this.requireDb();
    const changes = db.transaction(() => {
      if (this.ftsAvailable) db.prepare("DELETE FROM memory_cards_fts WHERE id = ?").run(id);
      return db.prepare("DELETE FROM memory_cards WHERE id = ?").run(id).changes;
    })();
    return changes > 0;
  }

  search(query: string, options: {
    scopes: MemoryCardScope[];
    limit?: number;
    queryVector?: number[];
    includeSensitive?: boolean;
    mmrLambda?: number;
  }): MemorySearchHit[] {
    const db = this.requireDb();
    const limit = Math.max(1, options.limit ?? 5);
    const now = this.now();
    const placeholders = options.scopes.map(() => "?").join(",");
    if (!placeholders) return [];
    const rows = db.prepare(`
      SELECT * FROM memory_cards
      WHERE scope IN (${placeholders})
        AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY importance DESC, last_accessed_at DESC
    `).all(...options.scopes, now) as Array<Record<string, unknown>>;

    const cardsWithVectors = rows.map((row) => ({ card: this.rowToCard(row), vector: this.rowVector(row) }));
    const superseded = new Set(cardsWithVectors.map((item) => item.card.supersedes).filter(Boolean));
    const queryTokens = tokenize(query);
    const scored = cardsWithVectors
      .filter(({ card }) => !superseded.has(card.id))
      .filter(({ card }) => options.includeSensitive || !["sensitive", "secret"].includes(card.sensitivity))
      .map(({ card, vector }) => {
        const contentTokens = tokenize(card.content);
        let matches = 0;
        for (const token of queryTokens) if (contentTokens.has(token) || card.content.toLowerCase().includes(token)) matches++;
        const keyword = queryTokens.size === 0 ? 0 : matches / queryTokens.size;
        const semantic = cosine(options.queryVector ?? null, vector);
        const ageDays = Math.max(0, now - card.createdAt) / 86_400_000;
        const recency = Math.pow(0.97, ageDays);
        const score = keyword * 0.45 + semantic * 0.35 + card.importance * 0.12 + card.confidence * 0.04 + recency * 0.04;
        const reasons = [
          keyword > 0 ? `keyword=${keyword.toFixed(2)}` : "",
          semantic > 0 ? `vector=${semantic.toFixed(2)}` : "",
          `importance=${card.importance.toFixed(2)}`,
          recency > 0.5 ? "recent" : "",
        ].filter(Boolean);
        return { card, vector, score, reason: reasons.join(", ") };
      })
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || left.card.id.localeCompare(right.card.id));

    const selected: typeof scored = [];
    const lambda = Math.max(0, Math.min(1, options.mmrLambda ?? 0.7));
    while (selected.length < limit && scored.length > 0) {
      let bestIndex = 0;
      let bestMmr = Number.NEGATIVE_INFINITY;
      for (let index = 0; index < scored.length; index++) {
        const candidate = scored[index];
        const maxSimilarity = selected.reduce((max, chosen) => {
          const vectorSimilarity = cosine(candidate.vector, chosen.vector);
          const textSimilarity = jaccard(candidate.card.content, chosen.card.content);
          return Math.max(max, vectorSimilarity * 0.7 + textSimilarity * 0.3);
        }, 0);
        const mmr = lambda * candidate.score - (1 - lambda) * maxSimilarity;
        if (mmr > bestMmr) {
          bestMmr = mmr;
          bestIndex = index;
        }
      }
      selected.push(scored.splice(bestIndex, 1)[0]);
    }
    const touch = db.prepare("UPDATE memory_cards SET last_accessed_at = ? WHERE id = ?");
    for (const hit of selected) touch.run(now, hit.card.id);
    return selected.map(({ card, score, reason }) => ({ card, score, reason }));
  }

  getAlwaysVisible(scopes: MemoryCardScope[] = ["global", "workspace", "project"]): MemoryCard[] {
    const now = this.now();
    const placeholders = scopes.map(() => "?").join(",");
    if (!placeholders) return [];
    const rows = this.requireDb().prepare(`
      SELECT * FROM memory_cards
      WHERE scope IN (${placeholders})
        AND kind IN ('preference', 'constraint')
        AND sensitivity NOT IN ('sensitive', 'secret')
        AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY importance DESC, id ASC
      LIMIT 20
    `).all(...scopes, now) as Array<Record<string, unknown>>;
    return rows.map((row) => this.rowToCard(row));
  }

  get(id: string): MemoryCard | null {
    const row = this.requireDb().prepare("SELECT * FROM memory_cards WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    const card = this.rowToCard(row);
    return ["sensitive", "secret"].includes(card.sensitivity) ? null : card;
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  private rowToCard(row: Record<string, unknown>): MemoryCard {
    return {
      id: String(row.id),
      kind: String(row.kind) as MemoryCardKind,
      scope: String(row.scope) as MemoryCardScope,
      content: String(row.content),
      sourceEventIds: JSON.parse(String(row.source_event_ids ?? "[]")) as string[],
      confidence: Number(row.confidence),
      importance: Number(row.importance),
      sensitivity: String(row.sensitivity) as MemorySensitivity,
      createdAt: Number(row.created_at),
      lastAccessedAt: Number(row.last_accessed_at),
      ...(row.expires_at ? { expiresAt: Number(row.expires_at) } : {}),
      ...(row.supersedes ? { supersedes: String(row.supersedes) } : {}),
    };
  }

  private rowVector(row: Record<string, unknown>): number[] | null {
    if (!row.vector) return null;
    const buffer = row.vector as Buffer;
    return Array.from(new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4));
  }

  private requireDb(): Database.Database {
    if (!this.db) throw new Error("memory card index is not initialized");
    return this.db;
  }
}
