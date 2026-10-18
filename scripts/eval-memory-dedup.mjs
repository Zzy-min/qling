// Deterministic eval: PersistedMemory top-k dedup via MMR.
// Run with either lambda value to compare before/after behavior, e.g.
//   QLING_MEMORY_MMR_LAMBDA=1 node scripts/eval-memory-dedup.mjs
//   node scripts/eval-memory-dedup.mjs
// Depends on the built dist/ output. Uses a throwaway temp dir, never real user memory.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { PersistedMemory } from "../dist/memory.js";

const TOP_K = 5;

function effectiveLambda() {
  const raw = process.env.QLING_MEMORY_MMR_LAMBDA;
  if (raw === undefined || raw.trim() === "") return 0.7;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) return 0.7;
  return value;
}

// Duplicate-heavy corpus: two near-duplicate clusters (English + Chinese) plus
// several distinct topics. The `source` field doubles as the topic label.
const ENTRIES = [
  { topic: "dup-en", content: "memory retrieval pipeline cache note variant alpha", importance: 0.9 },
  { topic: "dup-en", content: "memory retrieval pipeline cache note variant beta", importance: 0.899 },
  { topic: "dup-en", content: "memory retrieval pipeline cache note variant gamma", importance: 0.898 },
  { topic: "dup-en", content: "memory retrieval pipeline cache note variant delta", importance: 0.897 },
  { topic: "dup-zh", content: "memory 项目记忆 数据库迁移 缓存方案 甲", importance: 0.896 },
  { topic: "dup-zh", content: "memory 项目记忆 数据库迁移 缓存方案 乙", importance: 0.895 },
  { topic: "dup-zh", content: "memory 项目记忆 数据库迁移 缓存方案 丙", importance: 0.894 },
  { topic: "db", content: "memory database migration rollback strategy", importance: 0.7 },
  { topic: "ui", content: "memory frontend animation timing budget", importance: 0.69 },
  { topic: "security", content: "memory security sandbox permission model", importance: 0.68 },
  { topic: "api", content: "memory api rate limit backoff policy", importance: 0.67 },
];

function metrics(results) {
  const topics = results.map((entry) => entry.source);
  const unique = new Set(topics);
  const seen = new Set();
  let duplicates = 0;
  for (const topic of topics) {
    if (seen.has(topic)) duplicates++;
    else seen.add(topic);
  }
  const count = results.length || 1;
  return {
    uniqueTopicRate: unique.size / count,
    duplicateRate: duplicates / count,
    topics,
  };
}

const lambda = effectiveLambda();
const dir = await mkdtemp(path.join(tmpdir(), "qling-eval-memory-dedup-"));
try {
  const memory = new PersistedMemory(dir);
  await memory.init();
  for (const entry of ENTRIES) {
    memory.add(entry.content, entry.topic, entry.importance);
  }
  const results = await memory.getRelevant("memory", TOP_K);
  const { uniqueTopicRate, duplicateRate, topics } = metrics(results);
  console.log(JSON.stringify({
    eval: "memory-dedup",
    lambda,
    topK: TOP_K,
    resultCount: results.length,
    uniqueTopicRate,
    duplicateRate,
    topics,
  }, null, 2));
} finally {
  await rm(dir, { recursive: true, force: true });
}
