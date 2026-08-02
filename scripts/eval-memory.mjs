import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { MemoryCardIndex } from "../dist/memory/memory-card-index.js";

const dir = await mkdtemp(path.join(tmpdir(), "qling-eval-memory-"));
const index = new MemoryCardIndex({ memoryDir: dir });
try {
  await index.init();
  const now = Date.now();
  index.upsert({ id: "right", kind: "decision", scope: "workspace", content: "runtime events use sqlite WAL", sourceEventIds: ["e1"], confidence: 1, importance: 1, sensitivity: "internal", createdAt: now, lastAccessedAt: now });
  index.upsert({ id: "secret", kind: "fact", scope: "workspace", content: "sqlite key secret", sourceEventIds: [], confidence: 1, importance: 1, sensitivity: "secret", createdAt: now, lastAccessedAt: now });
  const hits = index.search("sqlite runtime", { scopes: ["workspace"], limit: 5 });
  assert.equal(hits[0].card.id, "right");
  assert.equal(hits.some((hit) => hit.card.id === "secret"), false);
  console.log(JSON.stringify({ eval: "memory", passed: 2, top5: hits.map((hit) => hit.card.id) }));
} finally {
  index.close();
  await rm(dir, { recursive: true, force: true });
}
