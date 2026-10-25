import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MemoryCardIndex } from "../dist/memory/memory-card-index.js";

const QUERY_COUNT = Number(process.env.QLING_EVAL_MEMORY_QUERIES ?? 500);
const DISTRACTORS_PER_QUERY = 3;
const VECTOR_SIZE = 64;
const dir = await mkdtemp(path.join(tmpdir(), "qling-eval-memory-"));
const now = Date.now();
const index = new MemoryCardIndex({ memoryDir: dir, now: () => now });

function vectorFor(topic) {
  const vector = Array(VECTOR_SIZE).fill(0);
  vector[topic % VECTOR_SIZE] = 1;
  vector[(topic * 17 + 11) % VECTOR_SIZE] += 0.35;
  return vector;
}

try {
  await index.init();
  for (let topic = 0; topic < QUERY_COUNT; topic++) {
    const token = `topic_${topic.toString(36)}_needle`;
    index.upsert({
      id: `target-${topic}`,
      kind: topic % 2 ? "decision" : "practice",
      scope: "workspace",
      content: `${token} canonical decision for subsystem ${topic}`,
      sourceEventIds: [`event-${topic}`],
      confidence: 0.95,
      importance: 0.9,
      sensitivity: "internal",
      createdAt: now - (topic % 30) * 86_400_000,
      lastAccessedAt: now,
    }, vectorFor(topic));
    for (let distractor = 0; distractor < DISTRACTORS_PER_QUERY; distractor++) {
      index.upsert({
        id: `distractor-${topic}-${distractor}`,
        kind: "fact",
        scope: distractor === 0 ? "project" : "workspace",
        content: `subsystem ${topic} adjacent note variant ${distractor} without the canonical token`,
        sourceEventIds: [],
        confidence: 0.5,
        importance: 0.35,
        sensitivity: "internal",
        createdAt: now - 180 * 86_400_000,
        lastAccessedAt: now - 180 * 86_400_000,
      }, vectorFor(topic + distractor + 1));
    }
  }

  index.upsert({ id: "secret", kind: "fact", scope: "workspace", content: "topic_secret_needle api_key=sk-supersecret123456", sourceEventIds: [], confidence: 1, importance: 1, sensitivity: "secret", createdAt: now, lastAccessedAt: now }, vectorFor(1));
  index.upsert({ id: "expired", kind: "fact", scope: "workspace", content: "topic_expired_needle obsolete", sourceEventIds: [], confidence: 1, importance: 1, sensitivity: "internal", createdAt: now, lastAccessedAt: now, expiresAt: now - 1 }, vectorFor(2));
  index.upsert({ id: "cross-project", kind: "fact", scope: "project", content: "topic_cross_project_needle isolated", sourceEventIds: [], confidence: 1, importance: 1, sensitivity: "internal", createdAt: now, lastAccessedAt: now }, vectorFor(3));

  let recalled = 0;
  let reciprocalRank = 0;
  for (let topic = 0; topic < QUERY_COUNT; topic++) {
    const hits = index.search(`find topic_${topic.toString(36)}_needle subsystem ${topic}`, {
      scopes: ["workspace"],
      limit: 5,
      queryVector: vectorFor(topic),
    });
    const rank = hits.findIndex((hit) => hit.card.id === `target-${topic}`);
    if (rank >= 0) {
      recalled++;
      reciprocalRank += 1 / (rank + 1);
    }
  }

  const secretHits = index.search("topic_secret_needle", { scopes: ["workspace"], limit: 5 });
  const expiredHits = index.search("topic_expired_needle", { scopes: ["workspace"], limit: 5 });
  const crossProjectHits = index.search("topic_cross_project_needle", { scopes: ["workspace"], limit: 5 });
  const recallAt5 = recalled / QUERY_COUNT;
  const mrr = reciprocalRank / QUERY_COUNT;
  assert.ok(recallAt5 >= 0.9, `Top-5 recall ${recallAt5} is below 0.9`);
  assert.equal(secretHits.some((hit) => hit.card.id === "secret"), false);
  assert.equal(expiredHits.some((hit) => hit.card.id === "expired"), false);
  assert.equal(crossProjectHits.some((hit) => hit.card.id === "cross-project"), false);

  console.log(JSON.stringify({
    eval: "memory",
    status: "pass",
    queries: QUERY_COUNT,
    cards: QUERY_COUNT * (DISTRACTORS_PER_QUERY + 1) + 3,
    recallAt5,
    mrr,
    leakage: { secret: 0, expired: 0, crossProject: 0 },
    evidence: {
      executor: "component",
      model: "none",
      verifier: "statistical_oracle",
      claim: "Measures Top-5 retrieval over a large deterministic hybrid keyword/vector corpus and verifies scope, expiry, and sensitivity isolation.",
      limitations: ["Synthetic corpus; does not substitute for a labeled corpus of real user memories."],
    },
  }));
} finally {
  index.close();
  await rm(dir, { recursive: true, force: true });
}
