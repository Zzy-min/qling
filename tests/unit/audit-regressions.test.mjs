import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { validateCompactionCandidate } from "../../dist/context-compactor.js";
import { MCPClient } from "../../dist/mcp/client.js";
import { SessionScheduler } from "../../dist/session/session-scheduler.js";
import { MemoryCardIndex } from "../../dist/memory/memory-card-index.js";
import { CognitiveIndex } from "../../dist/memory/cognitive-index.js";
import { PersistedMemory } from "../../dist/memory.js";

const user = { role: "user", content: "keep constraint" };
const call = {
  role: "assistant",
  content: "",
  tool_calls: [{ id: "c1", type: "function", function: { name: "read", arguments: "{}" } }],
};
const tool = { role: "tool", content: "fixture", tool_call_id: "c1" };

test("compaction validator rejects reversed, missing, and duplicate tool results", () => {
  const original = [user, call, tool];

  const reversed = validateCompactionCandidate(original, [user, tool, call]);
  assert.equal(reversed.ok, false);
  assert.match(reversed.reason, /orphan tool result/);

  const missing = validateCompactionCandidate(original, [user, call]);
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /missing tool result/);

  const duplicate = validateCompactionCandidate(original, [user, call, tool, tool]);
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.reason, /duplicate tool result/);

  const valid = validateCompactionCandidate(original, [user, call, tool]);
  assert.equal(valid.ok, true);
});

test("MCP image-only results persist a consumable artifact and never succeed with empty output", async () => {
  const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-mcp-artifact-"));
  const previous = process.env.QLING_MCP_ARTIFACT_DIR;
  process.env.QLING_MCP_ARTIFACT_DIR = artifactDir;
  try {
    const client = new MCPClient({ name: "synthetic", command: "never-started" });
    client.connected = true;
    client.transport = {};
    client.sendRequest = async () => ({
      content: [{ type: "image", mimeType: "image/png", data: Buffer.from("abc").toString("base64") }],
      structuredContent: { answer: 42 },
    });

    const image = await client.callTool("synthetic", {});
    assert.notEqual(image.is_error, true);
    assert.ok(image.output.length > 0);
    assert.match(image.output, /answer/);
    assert.match(image.meta.artifactRef, /^artifact:\/\/sha256\/[a-f0-9]{64}$/);
    assert.match(image.meta.artifacts[0].mimeType, /image\/png/);
    assert.ok(image.meta.artifacts[0].bytes > 0);
    assert.equal(await fs.readFile(image.meta.artifactPath, "utf8"), "abc");
  } finally {
    if (previous === undefined) delete process.env.QLING_MCP_ARTIFACT_DIR;
    else process.env.QLING_MCP_ARTIFACT_DIR = previous;
    await fs.rm(artifactDir, { recursive: true, force: true });
  }
});

test("MCP cancellation retains structured classification and unknown side-effect certainty", async () => {
  const client = new MCPClient({ name: "synthetic", command: "never-started" });
  client.connected = true;
  client.transport = {};
  client.sendRequest = async () => {
    throw new Error("MCP request aborted");
  };

  const canceled = await client.callTool("synthetic", {});
  assert.equal(canceled.is_error, true);
  assert.equal(canceled.error.code, "MCP_CANCELED");
  assert.equal(canceled.error.retriable, false);
  assert.equal(canceled.meta.mcp.cancellation.remoteStopConfirmed, false);
  assert.equal(canceled.meta.mcp.cancellation.sideEffectCertainty, "unknown");
});

test("MCP abort sends a best-effort cancellation notification to the transport", async () => {
  const messages = [];
  const client = new MCPClient({ name: "synthetic", command: "never-started" });
  client.connected = true;
  client.transport = {
    send: (msg) => { messages.push(msg); },
    onMessage: () => {},
    onError: () => {},
    onClose: () => {},
    close: async () => {},
  };

  const controller = new AbortController();
  const pending = client.callTool("slow", {}, controller.signal);
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();
  const result = await pending;

  assert.equal(result.error.code, "MCP_CANCELED");
  assert.ok(
    messages.some((msg) => msg.method === "notifications/cancelled" && msg.params?.requestId === 1),
    "client should notify the remote side that the request was cancelled"
  );
});

test("session scheduler refuses a running task already owned by another instance", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-audit-scheduler-"));
  try {
    let now = 1_000;
    let release;
    let entered;
    const running = new Promise((resolve) => { entered = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });

    const first = new SessionScheduler({
      stateDir,
      sessionId: "synthetic",
      clock: () => now,
      onDue: async () => { entered(); await gate; },
    });
    await first.init();
    const task = await first.createLoopTask({ prompt: "no side effects", intervalMs: 1_000, mode: "fixed" });

    now = 2_001;
    const firstRun = first.runDueTasksOnce();
    await running;

    // 同一实例的重入必须被 inFlight 拦截。
    assert.equal((await first.runDueTasksOnce()).triggered, 0);

    const second = new SessionScheduler({
      stateDir,
      sessionId: "synthetic",
      clock: () => now,
      onDue: async () => { throw new Error("must not run"); },
    });
    await second.init();
    assert.equal((await second.runDueTasksOnce()).triggered, 0);
    assert.equal((await second.listTasks()).find((item) => item.id === task.id).status, "running");

    release();
    await firstRun;
    const settled = (await second.listTasks()).find((item) => item.id === task.id);
    assert.equal(settled.status, "active");
    assert.equal(settled.attempt, undefined);
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test("stale running attempts move to blocked and require explicit reconcile", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-audit-scheduler-stale-"));
  try {
    let fired = 0;
    const scheduler = new SessionScheduler({
      stateDir,
      sessionId: "stale",
      clock: () => 100_000,
      onDue: async () => { fired++; },
    });
    await scheduler.init();
    const task = await scheduler.createLoopTask({ prompt: "stale", intervalMs: 1_000, mode: "fixed" });

    const stateFile = path.join(stateDir, "session-tasks", "stale.json");
    const raw = JSON.parse(await fs.readFile(stateFile, "utf8"));
    raw[0].status = "running";
    raw[0].nextRunAt = 100_000;
    raw[0].attempt = { id: "att_old", ownerId: "other-instance", claimedAt: 0 };
    await fs.writeFile(stateFile, JSON.stringify(raw), "utf8");

    assert.equal((await scheduler.runDueTasksOnce()).triggered, 0);
    assert.equal(fired, 0);
    const blocked = (await scheduler.listTasks()).find((item) => item.id === task.id);
    assert.equal(blocked.status, "blocked");
    assert.match(blocked.lastError.message, /reconcile/);

    // blocked 不会自动重放。
    assert.equal((await scheduler.runDueTasksOnce()).triggered, 0);
    assert.equal(fired, 0);

    await scheduler.reconcileTask(task.id);
    assert.equal((await scheduler.runDueTasksOnce()).triggered, 1);
    assert.equal(fired, 1);
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test("memory card search abstains when query has no keyword or semantic evidence", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-audit-cards-"));
  try {
    const index = new MemoryCardIndex({ memoryDir: dir, now: () => 10_000 });
    await index.init();
    index.upsert({
      id: "unrelated",
      kind: "failure",
      scope: "workspace",
      content: "tomato harvest failed",
      sourceEventIds: [],
      confidence: 1,
      importance: 1,
      sensitivity: "internal",
      createdAt: 10_000,
      lastAccessedAt: 10_000,
    });
    assert.deepEqual(index.search("quantum compiler", { scopes: ["workspace"] }), []);
    // 空 query 用于列举，保持原有先验排序行为。
    assert.equal(index.search("", { scopes: ["workspace"] }).length, 1);
    index.close();
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("legacy memory removal propagates to the vector projection", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-audit-legacy-"));
  try {
    const index = new CognitiveIndex(dir);
    await index.init();
    const memory = new PersistedMemory(dir);
    memory.setCognitiveIndex(index, { getEmbedding: async () => [1, 0] });

    const entry = memory.add("synthetic old fact", "audit", 0.6);
    index.upsertVector(entry, [1, 0]);
    assert.equal((await memory.getRelevant("old fact", 5)).some((item) => item.id === entry.id), true);

    memory.remove(entry.id);
    assert.equal((await memory.getRelevant("old fact", 5)).some((item) => item.id === entry.id), false);
    assert.equal(index.searchVector([1, 0], 5).length, 0);
    index.close();
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});