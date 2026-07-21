import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AgentLoop } from "../../dist/agent-loop.js";

async function withAgent(streaming, run) {
  const stateDir = await mkdtemp(join(tmpdir(), "qling-agent-stream-"));
  const previous = {
    wal: process.env.QLING_MEMORY_WAL_ENABLED,
    metrics: process.env.QLING_METRICS_ENABLED,
    mcp: process.env.QLING_MCP_SERVERS,
  };
  process.env.QLING_MEMORY_WAL_ENABLED = "false";
  process.env.QLING_METRICS_ENABLED = "false";
  delete process.env.QLING_MCP_SERVERS;
  const agent = new AgentLoop({
    apiKey: "test-key",
    maxIterations: 1,
    experimental: { streaming },
    runtime: {
      workspaceDir: process.cwd(),
      fileCacheDir: join(stateDir, "cache"),
      fileStateDir: stateDir,
      maxSteps: 1,
      parseRetries: 1,
      toolRepeatLimit: 6,
      timeoutMs: 5000,
    },
  });
  try {
    agent.checkAutoDream = async () => {};
    await run(agent);
  } finally {
    await agent.shutdown();
    await rm(stateDir, { recursive: true, force: true });
    for (const [name, value] of Object.entries(previous)) {
      const key = name === "wal" ? "QLING_MEMORY_WAL_ENABLED" : name === "metrics" ? "QLING_METRICS_ENABLED" : "QLING_MCP_SERVERS";
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("AgentLoop enables deltas only when interactive streaming is explicitly configured", async () => {
  await withAgent(true, async (agent) => {
    const deltas = [];
    const fallbacks = [];
    agent.on("response_delta", (delta) => deltas.push(delta));
    agent.on("stream_fallback", (reason) => fallbacks.push(reason));
    agent.llmClient.chatCompletions = async (input) => {
      assert.equal(input.stream, true);
      input.onTextDelta("hel");
      input.onTextDelta("lo");
      input.onStreamFallback("test-fallback");
      return { content: "hello", streamed: true };
    };
    agent.addUserMessage("stream");
    assert.equal(await agent.run(), "hello");
    assert.deepEqual(deltas, ["hel", "lo"]);
    assert.deepEqual(fallbacks, ["test-fallback"]);
    assert.equal(agent.getMessagesSnapshot().filter((message) => message.role === "assistant").length, 1);
  });
});

test("AgentLoop keeps complete responses as the compatibility default", async () => {
  await withAgent(false, async (agent) => {
    agent.llmClient.chatCompletions = async (input) => {
      assert.equal(input.stream, false);
      return { content: "complete", streamed: false };
    };
    agent.addUserMessage("complete");
    assert.equal(await agent.run(), "complete");
  });
});
