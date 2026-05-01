// ============================================================
// 轻灵 - Memory Compactor（记忆压缩）
// 去重 + 过期 + 上限裁剪
// ============================================================

import type { PersistedEntry } from "../types.js";

export interface CompactionResult {
  before: number;
  after: number;
  removed: number;
  merged: number;
}

export interface CompactionApplyResult {
  entries: PersistedEntry[];
  stats: CompactionResult;
}

export interface CompactorOptions {
  maxEntries: number;
  expireAgeMs: number;       // default 90 days
  expireMinImportance: number; // default 0.3
  dedupSimilarityThreshold: number; // default 0.8
}

const DEFAULT_OPTIONS: CompactorOptions = {
  maxEntries: 1000,
  expireAgeMs: 90 * 24 * 60 * 60 * 1000,
  expireMinImportance: 0.3,
  dedupSimilarityThreshold: 0.8,
};

export class MemoryCompactor {
  private options: CompactorOptions;

  constructor(options: Partial<CompactorOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  compact(entries: PersistedEntry[]): CompactionResult {
    return this.compactWithEntries(entries).stats;
  }

  compactWithEntries(entries: PersistedEntry[]): CompactionApplyResult {
    const before = entries.length;
    let removed = 0;

    // 1. 过期清理
    const now = Date.now();
    const afterExpire = entries.filter((e) => {
      const age = now - e.createdAt;
      if (age > this.options.expireAgeMs && e.importance < this.options.expireMinImportance) {
        removed++;
        return false;
      }
      return true;
    });

    // 2. 去重合并
    const deduped = this.deduplicate(afterExpire);
    const merged = afterExpire.length - deduped.length;

    // 3. 上限裁剪（按重要性排序，保留高重要性的）
    const capped = this.capByImportance(deduped, this.options.maxEntries);
    const afterCapRemoved = deduped.length - capped.length;
    removed += afterCapRemoved;

    return {
      entries: capped,
      stats: { before, after: capped.length, removed, merged },
    };
  }

  // --- Private ---

  private deduplicate(entries: PersistedEntry[]): PersistedEntry[] {
    const kept: PersistedEntry[] = [];
    for (const entry of entries) {
      const duplicate = kept.find((k) => this.similarity(k.content, entry.content) >= this.options.dedupSimilarityThreshold);
      if (duplicate) {
        // keep the one with higher importance
        if (entry.importance > duplicate.importance) {
          const idx = kept.indexOf(duplicate);
          kept[idx] = entry;
        }
      } else {
        kept.push(entry);
      }
    }
    return kept;
  }

  private similarity(a: string, b: string): number {
    // simple bigram similarity (0-1)
    const bigramsA = this.bigrams(a.toLowerCase());
    const bigramsB = this.bigrams(b.toLowerCase());
    if (bigramsA.size === 0 && bigramsB.size === 0) return 1;
    if (bigramsA.size === 0 || bigramsB.size === 0) return 0;
    let intersection = 0;
    for (const bg of bigramsA) {
      if (bigramsB.has(bg)) intersection++;
    }
    const union = bigramsA.size + bigramsB.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  private bigrams(text: string): Set<string> {
    const set = new Set<string>();
    for (let i = 0; i < text.length - 1; i++) {
      set.add(text.slice(i, i + 2));
    }
    return set;
  }

  private capByImportance(entries: PersistedEntry[], max: number): PersistedEntry[] {
    if (entries.length <= max) return entries;
    return entries
      .sort((a, b) => b.importance - a.importance)
      .slice(0, max);
  }
}
