import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { PersistedMemory } from "../../dist/memory.js";

/**
 * Build a fresh PersistedMemory with the given entries, run a query under a
 * specific QLING_MEMORY_MMR_LAMBDA value, then always restore the env and clean up.
 */
async function runQuery(entries, query, limit, lambda) {
  const previous = process.env.QLING_MEMORY_MMR_LAMBDA;
  if (lambda === undefined) delete process.env.QLING_MEMORY_MMR_LAMBDA;
  else process.env.QLING_MEMORY_MMR_LAMBDA = String(lambda);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-memory-mmr-"));
  try {
    const memory = new PersistedMemory(dir);
    await memory.init();
    for (const entry of entries) {
      memory.add(entry.content, entry.source ?? "test", entry.importance ?? 0.5);
    }
    return await memory.getRelevant(query, limit);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
    if (previous === undefined) delete process.env.QLING_MEMORY_MMR_LAMBDA;
    else process.env.QLING_MEMORY_MMR_LAMBDA = previous;
  }
}

const ENGLISH_ENTRIES = [
  { content: "memory retrieval pipeline note alpha", importance: 0.95 },
  { content: "memory retrieval pipeline note beta", importance: 0.94 },
  { content: "memory retrieval pipeline note gamma", importance: 0.93 },
  { content: "memory database migration rollback strategy", importance: 0.9 },
  { content: "memory frontend animation timing budget", importance: 0.85 },
];

function topicOf(content) {
  if (content.includes("note")) return "note";
  if (content.includes("database")) return "database";
  if (content.includes("frontend")) return "frontend";
  return "other";
}

test("default MMR diversifies near-duplicate English memories within top-k", async () => {
  const result = await runQuery(ENGLISH_ENTRIES, "memory", 3, undefined);
  assert.equal(result.length, 3);
  const topics = new Set(result.map((entry) => topicOf(entry.content)));
  assert.ok(topics.size >= 2, `expected >=2 topics, got ${JSON.stringify([...topics])}`);
});

test("lambda=1 disables MMR and preserves the pure relevance order", async () => {
  const result = await runQuery(ENGLISH_ENTRIES, "memory", 3, 1);
  assert.deepEqual(
    result.map((entry) => entry.content),
    [
      "memory retrieval pipeline note alpha",
      "memory retrieval pipeline note beta",
      "memory retrieval pipeline note gamma",
    ]
  );
});

test("invalid QLING_MEMORY_MMR_LAMBDA falls back to the 0.7 default", async () => {
  const fallback = await runQuery(ENGLISH_ENTRIES, "memory", 3, "not-a-number");
  const invalidHigh = await runQuery(ENGLISH_ENTRIES, "memory", 3, 42);
  const defaulted = await runQuery(ENGLISH_ENTRIES, "memory", 3, undefined);
  const ids = (result) => result.map((entry) => entry.content);
  assert.deepEqual(ids(fallback), ids(defaulted));
  assert.deepEqual(ids(invalidHigh), ids(defaulted));
});

test("MMR diversifies near-duplicate Chinese memories via CJK bigrams", async () => {
  const entries = [
    { content: "项目记忆 数据库迁移 双写方案", importance: 0.95 },
    { content: "项目记忆 数据库迁移 灰度方案", importance: 0.94 },
    { content: "项目记忆 数据库迁移 回滚方案", importance: 0.93 },
    { content: "项目记忆 前端动画 时长预算", importance: 0.9 },
    { content: "项目记忆 用户权限 模型设计", importance: 0.85 },
  ];
  const diverse = await runQuery(entries, "项目记忆", 3, undefined);
  assert.equal(diverse.length, 3);
  const chineseTopic = (content) => {
    if (content.includes("数据库迁移")) return "db";
    if (content.includes("前端动画")) return "frontend";
    if (content.includes("用户权限")) return "auth";
    return "other";
  };
  const topics = new Set(diverse.map((entry) => chineseTopic(entry.content)));
  assert.ok(topics.size >= 2, `expected >=2 Chinese topics, got ${JSON.stringify([...topics])}`);

  const disabled = await runQuery(entries, "项目记忆", 3, 1);
  assert.deepEqual(
    disabled.map((entry) => entry.content),
    ["项目记忆 数据库迁移 双写方案", "项目记忆 数据库迁移 灰度方案", "项目记忆 数据库迁移 回滚方案"]
  );
});

test("correction memories are guaranteed inclusion even with low relevance", async () => {
  const entries = [
    { content: "memory retrieval pipeline note alpha", importance: 0.95 },
    { content: "memory retrieval pipeline note beta", importance: 0.94 },
    { content: "memory retrieval pipeline note gamma", importance: 0.93 },
    { content: "[用户纠错·必须遵守] always use the new session actor", source: "user-correction", importance: 0.2 },
  ];
  const disabled = await runQuery(entries, "memory", 2, 1);
  assert.equal(disabled.some((entry) => entry.source === "user-correction"), false);

  const withMmr = await runQuery(entries, "memory", 2, undefined);
  assert.equal(withMmr.length, 2);
  assert.equal(withMmr[0].source, "user-correction");
  assert.equal(withMmr.some((entry) => entry.source === "user-correction"), true);
});
