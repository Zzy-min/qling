import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AgentLoop } from "../../dist/agent-loop.js";

test("AgentLoop actor mode submits prompts through the durable runtime without duplicate user messages", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "qling-agent-actor-"));
  const previous = {
    mode: process.env.QLING_RUNTIME_MODE,
    wal: process.env.QLING_MEMORY_WAL_ENABLED,
    metrics: process.env.QLING_METRICS_ENABLED,
    mcp: process.env.QLING_MCP_SERVERS,
  };
  process.env.QLING_RUNTIME_MODE = "actor";
  process.env.QLING_MEMORY_WAL_ENABLED = "false";
  process.env.QLING_METRICS_ENABLED = "false";
  delete process.env.QLING_MCP_SERVERS;
  const agent = new AgentLoop({
    apiKey: "test-key",
    maxIterations: 1,
    runtime: {
      workspaceDir: process.cwd(),
      fileCacheDir: join(stateDir, "cache"),
      fileStateDir: stateDir,
      maxSteps: 1,
      parseRetries: 1,
      toolRepeatLimit: 6,
      timeoutMs: 5_000,
    },
  });
  try {
    await agent.waitForInit();
    agent.checkAutoDream = async () => {};
    agent.llmClient.chatCompletions = async () => ({ content: "actor-ok", streamed: false });

    assert.equal(agent.getAgentRuntimeMode(), "actor");
    assert.equal(await agent.submitPrompt("one prompt"), "actor-ok");
    assert.equal(
      agent.getMessagesSnapshot().filter((message) => message.role === "user" && !message.synthetic_reason).length,
      1
    );
    assert.equal(agent.getRuntimeSnapshot().state, "idle");
    assert.equal(agent.getRuntimeSnapshot().sequence > 0, true);
  } finally {
    await agent.shutdown();
    await rm(stateDir, { recursive: true, force: true });
    if (previous.mode === undefined) delete process.env.QLING_RUNTIME_MODE;
    else process.env.QLING_RUNTIME_MODE = previous.mode;
    if (previous.wal === undefined) delete process.env.QLING_MEMORY_WAL_ENABLED;
    else process.env.QLING_MEMORY_WAL_ENABLED = previous.wal;
    if (previous.metrics === undefined) delete process.env.QLING_METRICS_ENABLED;
    else process.env.QLING_METRICS_ENABLED = previous.metrics;
    if (previous.mcp === undefined) delete process.env.QLING_MCP_SERVERS;
    else process.env.QLING_MCP_SERVERS = previous.mcp;
  }
});

test("AgentLoop keeps legacy mode as the compatibility default", async () => {
  const previous = process.env.QLING_RUNTIME_MODE;
  const previousWal = process.env.QLING_MEMORY_WAL_ENABLED;
  const stateDir = await mkdtemp(join(tmpdir(), "qling-agent-legacy-"));
  delete process.env.QLING_RUNTIME_MODE;
  process.env.QLING_MEMORY_WAL_ENABLED = "false";
  const agent = new AgentLoop({
    apiKey: "test-key",
    runtime: {
      workspaceDir: process.cwd(),
      fileCacheDir: join(stateDir, "cache"),
      fileStateDir: stateDir,
      maxSteps: 1,
      parseRetries: 1,
      toolRepeatLimit: 6,
      timeoutMs: 5_000,
    },
  });
  try {
    assert.equal(agent.getAgentRuntimeMode(), "legacy");
  } finally {
    await agent.shutdown();
    await rm(stateDir, { recursive: true, force: true });
    if (previous !== undefined) process.env.QLING_RUNTIME_MODE = previous;
    if (previousWal === undefined) delete process.env.QLING_MEMORY_WAL_ENABLED;
    else process.env.QLING_MEMORY_WAL_ENABLED = previousWal;
  }
});

test("resumeRuntimeSession binds the actor to the current restored session id", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "qling-agent-resume-actor-"));
  const previous = process.env.QLING_RUNTIME_MODE;
  const previousWal = process.env.QLING_MEMORY_WAL_ENABLED;
  process.env.QLING_RUNTIME_MODE = "actor";
  process.env.QLING_MEMORY_WAL_ENABLED = "false";
  const agent = new AgentLoop({
    apiKey: "test-key",
    runtime: { workspaceDir: process.cwd(), fileCacheDir: join(stateDir, "cache"), fileStateDir: stateDir, maxSteps: 1, parseRetries: 1, toolRepeatLimit: 6, timeoutMs: 5_000 },
  });
  try {
    await agent.waitForInit();
    const firstId = agent.sessionActorId;
    agent.sessionId = `${firstId}-restored`;
    await agent.resumeRuntimeSession();
    assert.equal(agent.sessionActorId, agent.sessionId);
    assert.notEqual(agent.sessionActorId, firstId);
  } finally {
    await agent.shutdown();
    await rm(stateDir, { recursive: true, force: true });
    if (previous === undefined) delete process.env.QLING_RUNTIME_MODE;
    else process.env.QLING_RUNTIME_MODE = previous;
    if (previousWal === undefined) delete process.env.QLING_MEMORY_WAL_ENABLED;
    else process.env.QLING_MEMORY_WAL_ENABLED = previousWal;
  }
});
