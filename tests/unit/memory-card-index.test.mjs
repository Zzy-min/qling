import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { MemoryCardIndex, inferMemorySensitivity } from "../../dist/memory/memory-card-index.js";
import { MemoryStore } from "../../dist/memory.js";

async function createIndex(now = () => 1_000_000) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-memory-card-"));
  const index = new MemoryCardIndex({ memoryDir: dir, now });
  await index.init();
  return { dir, index };
}

test("memory card search filters scope expiry and sensitive records", async () => {
  const { index } = await createIndex();
  index.upsert({ id: "project", kind: "decision", scope: "project", content: "use sqlite WAL for runtime events", sourceEventIds: ["e1"], confidence: 0.9, importance: 0.9, sensitivity: "internal", createdAt: 900_000, lastAccessedAt: 900_000 });
  index.upsert({ id: "other", kind: "fact", scope: "workspace", content: "unrelated workspace fact", sourceEventIds: ["e2"], confidence: 0.8, importance: 0.5, sensitivity: "internal", createdAt: 900_000, lastAccessedAt: 900_000 });
  index.upsert({ id: "expired", kind: "fact", scope: "project", content: "sqlite old decision", sourceEventIds: [], confidence: 0.8, importance: 1, sensitivity: "internal", createdAt: 100, lastAccessedAt: 100, expiresAt: 500_000 });
  index.upsert({ id: "secret", kind: "fact", scope: "project", content: "sqlite token sk-abcdefghijklmnop", sourceEventIds: [], confidence: 0.9, importance: 1, sensitivity: "secret", createdAt: 900_000, lastAccessedAt: 900_000 });

  const hits = index.search("sqlite runtime", { scopes: ["project"], limit: 5 });
  assert.deepEqual(hits.map((hit) => hit.card.id), ["project"]);
  assert.match(hits[0].reason, /keyword|importance|recent/i);
  index.close();
});

test("memory card search uses vector relevance and MMR to avoid duplicate results", async () => {
  const { index } = await createIndex();
  const base = { kind: "practice", scope: "workspace", sourceEventIds: [], confidence: 0.9, importance: 0.8, sensitivity: "internal", createdAt: 900_000, lastAccessedAt: 900_000 };
  index.upsert({ ...base, id: "a", content: "run npm build after TypeScript changes" }, [1, 0]);
  index.upsert({ ...base, id: "b", content: "run npm build after TS edits" }, [0.99, 0.01]);
  index.upsert({ ...base, id: "c", content: "inspect git diff before delivery" }, [0.8, 0.2]);
  const hits = index.search("verification", { scopes: ["workspace"], queryVector: [1, 0], limit: 2, mmrLambda: 0.55 });
  assert.equal(hits[0].card.id, "a");
  assert.equal(hits.length, 2);
  assert.notEqual(hits[1].card.id, "b");
  index.close();
});

test("always-visible cards contain only active preferences and constraints", async () => {
  const { index } = await createIndex();
  const base = { scope: "global", sourceEventIds: [], confidence: 0.9, importance: 0.9, sensitivity: "internal", createdAt: 900_000, lastAccessedAt: 900_000 };
  index.upsert({ ...base, id: "pref", kind: "preference", content: "reply in Chinese" });
  index.upsert({ ...base, id: "constraint", kind: "constraint", content: "do not push without approval" });
  index.upsert({ ...base, id: "fact", kind: "fact", content: "package version is 1.3.1" });
  assert.deepEqual(index.getAlwaysVisible().map((card) => card.id), ["constraint", "pref"]);
  index.close();
});

test("credential shaped memories are inferred as secret", () => {
  assert.equal(inferMemorySensitivity("Authorization: Bearer abcdefghijklmnop"), "secret");
  assert.equal(inferMemorySensitivity("OPENAI_API_KEY=sk-abcdefghijklmnop"), "secret");
  assert.equal(inferMemorySensitivity("ghp_abcdefghijklmnopqrstuvwxyz123456"), "secret");
  assert.equal(inferMemorySensitivity("GITHUB_TOKEN=abcdefghijklmnop"), "secret");
  assert.equal(inferMemorySensitivity("DATABASE_URL=postgres://user:password@host/db"), "secret");
  assert.equal(inferMemorySensitivity('{"GITHUB_TOKEN": "abcdefghijklmnop"}'), "secret");
  assert.equal(inferMemorySensitivity("postgres://user:password@host/db"), "secret");
  assert.equal(inferMemorySensitivity("-----BEGIN ENCRYPTED PRIVATE KEY-----"), "secret");
  assert.equal(inferMemorySensitivity("-----BEGIN PRIVATE KEY-----"), "secret");
  assert.equal(inferMemorySensitivity("use local sqlite"), "internal");
});

test("MemoryStore uses card retrieval behind the memory-v2 feature flag", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-memory-store-card-"));
  const previous = process.env.QLING_FEATURES_MEMORY_CARDS;
  process.env.QLING_FEATURES_MEMORY_CARDS = "true";
  const store = new MemoryStore(path.join(dir, "memory"), { workspaceDir: path.join(dir, "workspace") });
  try {
    await store.init();
    store.add("do not push without explicit approval", "user-correction", 0.99, "global");
    store.add("use sqlite WAL for runtime state", "decision", 0.9, "workspace");
    const hits = await store.getRelevant("sqlite runtime", 5);
    assert.equal(hits[0].content, "use sqlite WAL for runtime state");
    assert.equal(store.getAlwaysVisibleMemoryCards().some((card) => card.kind === "constraint"), true);
  } finally {
    await store.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
    if (previous === undefined) delete process.env.QLING_FEATURES_MEMORY_CARDS;
    else process.env.QLING_FEATURES_MEMORY_CARDS = previous;
  }
});

test("user corrections become immediately retrievable memory cards", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-memory-correction-card-"));
  const previous = process.env.QLING_FEATURES_MEMORY_CARDS;
  process.env.QLING_FEATURES_MEMORY_CARDS = "true";
  const store = new MemoryStore(path.join(dir, "memory"), { workspaceDir: path.join(dir, "workspace") });
  try {
    await store.init();
    await store.rememberUserCorrection("不要使用旧接口，必须调用新的 session actor");
    assert.equal(store.getAlwaysVisibleMemoryCards().some((card) => card.kind === "constraint"), true);
    assert.equal((await store.getRelevant("session actor", 5)).length > 0, true);
  } finally {
    await store.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
    if (previous === undefined) delete process.env.QLING_FEATURES_MEMORY_CARDS;
    else process.env.QLING_FEATURES_MEMORY_CARDS = previous;
  }
});
