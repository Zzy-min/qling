// ============================================================
// 轻灵 v0.3 - 核心特性专项测试 (.mjs)
// 覆盖：语义检索、状态机快照、Tool Spec 增强、动态发现解析
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SemanticMemoryIndex } from "../../dist/memory/semantic-index.js";
import { WorkflowBuilder } from "../../dist/workflow-types.js";
import { WorkflowRuntime } from "../../dist/workflow-runtime.js";
import { generateExamplesFromSchema } from "../../dist/pipeline/example-generator.js";
import { DiscoveryRegistry } from "../../dist/discovery-registry.js";

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "qling-v03-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("Qling v0.3 - Semantic Memory", async () => {
  await withTempDir(async (dir) => {
    const index = new SemanticMemoryIndex(dir);
    await index.init();

    const entry = {
      id: "test-1",
      content: "如何安装 Node.js?",
      source: "user",
      importance: 0.9,
      createdAt: Date.now()
    };

    const vector = new Array(1536).fill(0.1);
    vector[0] = 0.5;

    index.upsert(entry, vector);

    const results = index.search(vector, 1);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].entry.id, "test-1");
    assert.ok(results[0].score > 0.9);

    index.close();
  });
});

test("Qling v0.3 - Workflow & Checkpoints", async () => {
  await withTempDir(async (dir) => {
    const builder = new WorkflowBuilder("test-wf", "Test Workflow");
    builder.addState({
      id: "start",
      type: "task",
      description: "Initial state",
      transitions: [{ target: "end" }]
    });
    builder.addState({
      id: "end",
      type: "end",
      description: "Final state",
      transitions: []
    });
    const wf = builder.build();

    const runtime = new WorkflowRuntime(join(dir, "workflows"));
    await runtime.init();

    const cp = await runtime.start(wf, "sess-1", []);
    assert.strictEqual(cp.currentState, "start");
    assert.strictEqual(cp.status, "running");

    await runtime.transitionTo("end", "Finish task");
    const updatedCp = runtime.getCheckpoint();
    assert.strictEqual(updatedCp.currentState, "end");
    assert.strictEqual(updatedCp.status, "completed");

    const resumedRuntime = new WorkflowRuntime(join(dir, "workflows"));
    await resumedRuntime.init();
    const resumed = await resumedRuntime.resume(cp.runId);
    assert.strictEqual(resumed.currentState, "end");
    await resumedRuntime.transitionTo("start", "Reopen");
    assert.strictEqual(resumedRuntime.getCheckpoint().currentState, "start");
    await resumedRuntime.transitionTo("end", "Finish again");
    assert.strictEqual(resumedRuntime.getCheckpoint().status, "completed");

    await assert.rejects(
      () => resumedRuntime.resume("../outside"),
      /invalid workflow runId/i
    );

    const legacy = { ...resumedRuntime.getCheckpoint() };
    delete legacy.workflowDefinition;
    await writeFile(
      join(dir, "workflows", "legacy.checkpoint.json"),
      JSON.stringify({ ...legacy, runId: "legacy" })
    );
    await assert.rejects(
      () => resumedRuntime.resume("legacy"),
      /workflow definition is missing or inconsistent/i
    );
  });
});

test("Qling v0.3 - Tool Spec Boost", () => {
  const tool = {
    name: "test_tool",
    description: "A test tool",
    paramSchema: {
      path: { type: "string", description: "file path", required: true },
      force: { type: "boolean", description: "force overwrite" }
    }
  };

  const examples = generateExamplesFromSchema(tool);
  assert.ok(examples.length > 0);
  assert.ok(examples[0].includes("path="));
});

test("Qling v0.3 - Dynamic Discovery", async () => {
  await withTempDir(async (dir) => {
    const myPluginDir = join(dir, "my-plugin");
    await mkdir(myPluginDir, { recursive: true });

    const manifest = {
      id: "my-plugin",
      name: "My Plugin",
      version: "1.0.0",
      type: "skill",
      tools: [{ name: "dynamic_tool", description: "Discover me" }]
    };

    await writeFile(
      join(myPluginDir, "manifest.json"),
      JSON.stringify(manifest)
    );

    const registry = new DiscoveryRegistry([{ id: "local", uri: dir, type: "local" }]);
    await registry.syncAll();

    const tools = registry.getDiscoveredTools();
    assert.strictEqual(tools.length, 1);
    assert.strictEqual(tools[0].name, "dynamic_tool");
  });
});
