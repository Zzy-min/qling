import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

import {
  buildLocalMemoryReport,
  findLocalMemoryEntry,
  formatLocalMemoryEntry,
  formatLocalMemoryGraphReport,
  formatLocalMemoryPracticesReport,
  formatLocalMemoryReport,
  formatLocalMemorySearchReport,
  listLocalMemoryGraph,
  listLocalMemoryPractices,
  parseMemoryReportCount,
  parseMemorySearchArgs,
  searchLocalMemoryEntries,
} from "../../dist/memory-report.js";

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qingling-memory-report-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function writeMemory(root, entries) {
  const memoryDir = path.join(root, "memory");
  await fs.mkdir(memoryDir, { recursive: true });
  await fs.writeFile(path.join(memoryDir, "memory.json"), JSON.stringify(entries, null, 2), "utf8");
}

function entry(id, overrides = {}) {
  return {
    id,
    content: "local persisted memory content",
    source: "auto-dream",
    createdAt: 1_000,
    importance: 0.5,
    ...overrides,
  };
}

test("memory report handles missing memory directory without failing", async () => {
  await withTempDir(async (root) => {
    const report = await buildLocalMemoryReport(root);
    const output = formatLocalMemoryReport(report).join("\n");

    assert.equal(report.totalEntries, 0);
    assert.equal(report.entries.length, 0);
    assert.match(output, /本地记忆/);
    assert.match(output, /暂无/);
  });
});

test("memory report sorts by created time, clamps count, and does not read sessions", async () => {
  await withTempDir(async (root) => {
    await writeMemory(root, [
      entry("mem_old", { content: "old memory", createdAt: 1_000, importance: 0.9 }),
      entry("mem_new", { content: "new memory", createdAt: 3_000, importance: 0.1 }),
    ]);
    await fs.mkdir(path.join(root, "sessions"), { recursive: true });
    await fs.writeFile(path.join(root, "sessions", "session.json"), "SECRET_MEMORY_SESSION_BODY", "utf8");

    const report = await buildLocalMemoryReport(root, { count: 1 });
    const output = formatLocalMemoryReport(report).join("\n");

    assert.equal(report.totalEntries, 2);
    assert.deepEqual(report.entries.map((item) => item.id), ["mem_new"]);
    assert.match(output, /mem_new/);
    assert.doesNotMatch(output, /mem_old/);
    assert.doesNotMatch(output, /SECRET_MEMORY_SESSION_BODY/);
  });
});

test("memory report count defaults to 10 and clamps at 50", () => {
  assert.equal(parseMemoryReportCount(undefined), 10);
  assert.equal(parseMemoryReportCount("bad"), 10);
  assert.equal(parseMemoryReportCount("0"), 10);
  assert.equal(parseMemoryReportCount("51"), 50);
  assert.equal(parseMemoryReportCount("7"), 7);
});

test("memory report includes cognitive index table counts when available", async () => {
  await withTempDir(async (root) => {
    await writeMemory(root, [entry("mem_one")]);
    const dbPath = path.join(root, "memory", "cognitive_knowledge.db");
    const db = new Database(dbPath);
    try {
      db.exec(`
        CREATE TABLE embeddings (id TEXT PRIMARY KEY);
        CREATE TABLE kg_nodes (id TEXT PRIMARY KEY);
        CREATE TABLE kg_edges (source TEXT, target TEXT, relation TEXT);
        CREATE TABLE distilled_practices (id TEXT PRIMARY KEY);
        INSERT INTO embeddings (id) VALUES ('emb_1');
        INSERT INTO kg_nodes (id) VALUES ('node_1'), ('node_2');
        INSERT INTO kg_edges (source, target, relation) VALUES ('node_1', 'node_2', 'uses');
        INSERT INTO distilled_practices (id) VALUES ('prac_1');
      `);
    } finally {
      db.close();
    }

    const report = await buildLocalMemoryReport(root);

    assert.equal(report.cognitiveIndex.embeddings, 1);
    assert.equal(report.cognitiveIndex.kgNodes, 2);
    assert.equal(report.cognitiveIndex.kgEdges, 1);
    assert.equal(report.cognitiveIndex.distilledPractices, 1);
  });
});

test("memory entry detail resolves by id and formats content for audit", async () => {
  await withTempDir(async (root) => {
    await writeMemory(root, [
      entry("mem_target", {
        content: "需要审计的本地记忆",
        source: "manual",
        createdAt: 2_000,
        importance: 0.8,
      }),
    ]);

    const found = await findLocalMemoryEntry(root, "mem_target");
    const output = formatLocalMemoryEntry(found).join("\n");

    assert.equal(found?.id, "mem_target");
    assert.match(output, /mem_target/);
    assert.match(output, /需要审计的本地记忆/);
  });
});

test("memory search returns explainable local matches without reading sessions", async () => {
  await withTempDir(async (root) => {
    await writeMemory(root, [
      entry("mem_content", {
        content: "permission mode defaults to ask for local tools",
        source: "manual",
        createdAt: 1_000,
        importance: 0.2,
      }),
      entry("mem_source", {
        content: "unrelated local content",
        source: "permission-source",
        createdAt: 2_000,
        importance: 0.9,
      }),
      entry("mem_permission_id", {
        content: "id-only local content",
        source: "manual",
        createdAt: 3_000,
        importance: 0.8,
      }),
    ]);
    await fs.mkdir(path.join(root, "sessions"), { recursive: true });
    await fs.writeFile(path.join(root, "sessions", "session.json"), "SECRET_MEMORY_SEARCH_SESSION_BODY", "utf8");

    const report = await searchLocalMemoryEntries(root, { query: "permission", count: 3 });
    const output = formatLocalMemorySearchReport(report).join("\n");

    assert.equal(report.totalMatches, 3);
    assert.deepEqual(report.entries.map((item) => item.id), ["mem_content", "mem_source", "mem_permission_id"]);
    assert.deepEqual(report.entries[0].matchedVia, ["content:phrase", "content:permission"]);
    assert.deepEqual(report.entries[1].matchedVia, ["source:permission"]);
    assert.deepEqual(report.entries[2].matchedVia, ["id:permission"]);
    assert.match(output, /本地记忆搜索/);
    assert.match(output, /matched via/i);
    assert.doesNotMatch(output, /SECRET_MEMORY_SEARCH_SESSION_BODY/);
  });
});

test("memory search parses query count and handles empty or missing matches", async () => {
  assert.deepEqual(parseMemorySearchArgs(["permission", "2"]), { query: "permission", count: 2 });
  assert.deepEqual(parseMemorySearchArgs(["permission", "0"]), { query: "permission", count: 10 });
  assert.deepEqual(parseMemorySearchArgs(["permission", "51"]), { query: "permission", count: 50 });
  assert.deepEqual(parseMemorySearchArgs(["permission", "mode"]), { query: "permission mode", count: 10 });
  assert.deepEqual(parseMemorySearchArgs([]), { query: "", count: 10 });

  await withTempDir(async (root) => {
    await writeMemory(root, [entry("mem_one", { content: "local only" })]);

    const report = await searchLocalMemoryEntries(root, { query: "missing" });
    const output = formatLocalMemorySearchReport(report).join("\n");

    assert.equal(report.totalMatches, 0);
    assert.match(output, /无本地匹配/);
  });
});

test("memory practices lists distilled practices sorted by confidence and hits without reading sessions", async () => {
  await withTempDir(async (root) => {
    await writeMemory(root, [entry("mem_one")]);
    await fs.mkdir(path.join(root, "sessions"), { recursive: true });
    await fs.writeFile(path.join(root, "sessions", "session.json"), "SECRET_MEMORY_PRACTICE_SESSION_BODY", "utf8");

    const dbPath = path.join(root, "memory", "cognitive_knowledge.db");
    const db = new Database(dbPath);
    try {
      db.exec(`
        CREATE TABLE distilled_practices (
          id TEXT PRIMARY KEY,
          task_pattern TEXT NOT NULL,
          action_json TEXT NOT NULL,
          context_json TEXT NOT NULL,
          confidence REAL DEFAULT 1.0,
          hit_count INTEGER DEFAULT 1,
          created_at INTEGER NOT NULL
        );
        INSERT INTO distilled_practices (id, task_pattern, action_json, context_json, confidence, hit_count, created_at)
        VALUES
          ('prac_low', 'old pattern', '["old command"]', '["old.ts"]', 0.5, 9, 1000),
          ('prac_high', 'ship safely', '["npm run build","npm run ci:check"]', '["src/index.ts","tests/unit/memory-report.test.mjs"]', 0.9, 2, 2000);
      `);
    } finally {
      db.close();
    }

    const report = await listLocalMemoryPractices(root, { count: 1 });
    const output = formatLocalMemoryPracticesReport(report).join("\n");

    assert.equal(report.totalPractices, 2);
    assert.deepEqual(report.entries.map((item) => item.id), ["prac_high"]);
    assert.match(output, /本地蒸馏实践/);
    assert.match(output, /ship safely/);
    assert.match(output, /npm run build/);
    assert.match(output, /src\/index\.ts/);
    assert.doesNotMatch(output, /prac_low/);
    assert.doesNotMatch(output, /SECRET_MEMORY_PRACTICE_SESSION_BODY/);
  });
});

test("memory practices handles missing db and invalid json without failing", async () => {
  await withTempDir(async (missingRoot) => {
    const report = await listLocalMemoryPractices(missingRoot);
    const output = formatLocalMemoryPracticesReport(report).join("\n");

    assert.equal(report.totalPractices, 0);
    assert.match(output, /暂无/);
  });

  await withTempDir(async (root) => {
    await fs.mkdir(path.join(root, "memory"), { recursive: true });
    const dbPath = path.join(root, "memory", "cognitive_knowledge.db");
    const db = new Database(dbPath);
    try {
      db.exec(`
        CREATE TABLE distilled_practices (
          id TEXT PRIMARY KEY,
          task_pattern TEXT NOT NULL,
          action_json TEXT NOT NULL,
          context_json TEXT NOT NULL,
          confidence REAL DEFAULT 1.0,
          hit_count INTEGER DEFAULT 1,
          created_at INTEGER NOT NULL
        );
        INSERT INTO distilled_practices (id, task_pattern, action_json, context_json, confidence, hit_count, created_at)
        VALUES ('prac_bad_json', 'bad json pattern', 'not-json', '{"files":["src/a.ts"]}', 0.7, 1, 3000);
      `);
    } finally {
      db.close();
    }

    const report = await listLocalMemoryPractices(root);
    const output = formatLocalMemoryPracticesReport(report).join("\n");

    assert.equal(report.entries[0].id, "prac_bad_json");
    assert.match(output, /not-json/);
    assert.match(output, /Warning/);
  });
});

test("memory graph lists kg nodes sorted by recency and degree without reading sessions", async () => {
  await withTempDir(async (root) => {
    await fs.mkdir(path.join(root, "memory"), { recursive: true });
    await fs.mkdir(path.join(root, "sessions"), { recursive: true });
    await fs.writeFile(path.join(root, "sessions", "session.json"), "SECRET_MEMORY_GRAPH_SESSION_BODY", "utf8");

    const dbPath = path.join(root, "memory", "cognitive_knowledge.db");
    const db = new Database(dbPath);
    try {
      db.exec(`
        CREATE TABLE kg_nodes (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          label TEXT NOT NULL,
          metadata TEXT,
          last_seen INTEGER NOT NULL
        );
        CREATE TABLE kg_edges (
          source TEXT NOT NULL,
          target TEXT NOT NULL,
          relation TEXT NOT NULL,
          weight REAL DEFAULT 1.0,
          PRIMARY KEY (source, target, relation)
        );
        INSERT INTO kg_nodes (id, type, label, metadata, last_seen)
        VALUES
          ('node_old', 'file', 'src/old.ts', '{"secret":"metadata should stay hidden"}', 1000),
          ('node_recent_sparse', 'command', 'npm run build', '{}', 3000),
          ('node_recent_connected', 'task', 'ship local graph', '{}', 3000),
          ('node_target', 'file', 'src/memory-report.ts', '{}', 2000);
        INSERT INTO kg_edges (source, target, relation, weight)
        VALUES
          ('node_recent_connected', 'node_target', 'writes', 1.5),
          ('node_target', 'node_recent_connected', 'supports', 1.0),
          ('node_old', 'node_recent_connected', 'related_to', 0.5);
      `);
    } finally {
      db.close();
    }

    const report = await listLocalMemoryGraph(root, { count: 2 });
    const output = formatLocalMemoryGraphReport(report).join("\n");

    assert.equal(report.totalNodes, 4);
    assert.equal(report.totalEdges, 3);
    assert.deepEqual(report.entries.map((item) => item.id), ["node_recent_connected", "node_recent_sparse"]);
    assert.equal(report.entries[0].degree, 3);
    assert.match(output, /本地知识图谱/);
    assert.match(output, /ship local graph/);
    assert.match(output, /writes -> src\/memory-report\.ts/);
    assert.doesNotMatch(output, /node_old/);
    assert.doesNotMatch(output, /metadata should stay hidden/);
    assert.doesNotMatch(output, /SECRET_MEMORY_GRAPH_SESSION_BODY/);
  });
});

test("memory graph handles missing db and missing kg tables without failing", async () => {
  await withTempDir(async (missingRoot) => {
    const report = await listLocalMemoryGraph(missingRoot);
    const output = formatLocalMemoryGraphReport(report).join("\n");

    assert.equal(report.totalNodes, 0);
    assert.equal(report.totalEdges, 0);
    assert.match(output, /暂无/);
  });

  await withTempDir(async (root) => {
    await fs.mkdir(path.join(root, "memory"), { recursive: true });
    const dbPath = path.join(root, "memory", "cognitive_knowledge.db");
    const db = new Database(dbPath);
    try {
      db.exec("CREATE TABLE embeddings (id TEXT PRIMARY KEY)");
    } finally {
      db.close();
    }

    const report = await listLocalMemoryGraph(root);
    const output = formatLocalMemoryGraphReport(report).join("\n");

    assert.equal(report.totalNodes, 0);
    assert.equal(report.totalEdges, 0);
    assert.match(output, /暂无/);
  });
});
