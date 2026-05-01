// ============================================================
// Memory Compactor 单元测试
// ============================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MemoryCompactor } from "../../dist/memory/compactor.js";

describe("MemoryCompactor", () => {
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  it("should deduplicate similar entries", () => {
    const compactor = new MemoryCompactor({ dedupSimilarityThreshold: 0.6 });
    const entries = [
      { id: "1", content: "使用 TypeScript 开发项目", source: "auto", createdAt: now, importance: 0.5 },
      { id: "2", content: "使用 TypeScript 进行项目开发", source: "auto", createdAt: now - 1000, importance: 0.7 },
    ];
    const result = compactor.compact(entries);
    assert.equal(result.after, 1);
    assert.equal(result.merged, 1);
  });

  it("should keep entries with different content", () => {
    const compactor = new MemoryCompactor({ dedupSimilarityThreshold: 0.8 });
    const entries = [
      { id: "1", content: "项目使用 React 框架", source: "auto", createdAt: now, importance: 0.5 },
      { id: "2", content: "数据库连接配置在 config.ts 中", source: "auto", createdAt: now, importance: 0.5 },
    ];
    const result = compactor.compact(entries);
    assert.equal(result.after, 2);
    assert.equal(result.merged, 0);
  });

  it("should expire old low-importance entries", () => {
    const compactor = new MemoryCompactor({
      expireAgeMs: 90 * DAY,
      expireMinImportance: 0.3,
      maxEntries: 1000,
    });
    const entries = [
      { id: "1", content: "old low", source: "auto", createdAt: now - 100 * DAY, importance: 0.2 },
      { id: "2", content: "old high", source: "auto", createdAt: now - 100 * DAY, importance: 0.8 },
      { id: "3", content: "recent low", source: "auto", createdAt: now - 10 * DAY, importance: 0.2 },
    ];
    const result = compactor.compact(entries);
    assert.equal(result.after, 2);
    assert.equal(result.removed, 1);
  });

  it("should cap entries by importance", () => {
    const compactor = new MemoryCompactor({ maxEntries: 2 });
    const entries = [
      { id: "1", content: "low", source: "auto", createdAt: now, importance: 0.1 },
      { id: "2", content: "mid", source: "auto", createdAt: now, importance: 0.5 },
      { id: "3", content: "high", source: "auto", createdAt: now, importance: 0.9 },
    ];
    const result = compactor.compact(entries);
    assert.equal(result.after, 2);
    assert.equal(result.removed, 1);
  });

  it("should handle empty entries", () => {
    const compactor = new MemoryCompactor();
    const result = compactor.compact([]);
    assert.equal(result.before, 0);
    assert.equal(result.after, 0);
  });

  it("should keep higher importance entry on dedup", () => {
    const compactor = new MemoryCompactor({ dedupSimilarityThreshold: 0.6 });
    const entries = [
      { id: "1", content: "使用 React 开发前端应用", source: "auto", createdAt: now, importance: 0.3 },
      { id: "2", content: "使用 React 开发前端页面", source: "auto", createdAt: now - 1000, importance: 0.9 },
    ];
    const result = compactor.compact(entries);
    assert.equal(result.after, 1);
  });
});
