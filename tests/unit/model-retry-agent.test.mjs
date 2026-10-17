import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { AgentLoop } from "../../dist/agent-loop.js";
import { INTERRUPTED_RUN_REMINDER } from "../../dist/session/interrupted-run.js";

const ENV_KEYS = [
  "QLING_MEMORY_WAL_ENABLED",
  "QLING_METRICS_ENABLED",
  "QLING_MCP_SERVERS",
  "QLING_AUTO_COMPACT",
  "QLING_VERIFY_LLM",
  "QLING_LLM_MAX_RETRIES",
  "QLING_LLM_RETRY_BASE_MS",
  "QLING_LLM_RETRY_MAX_DELAY_MS",
  "QLING_LLM_RETRY_AFTER_MAX_MS",
  "QLING_LLM_RETRY_MAX_ELAPSED_MS",
  "QLING_LLM_RUN_RETRY_BUDGET",
  "QLING_LLM_FALLBACK_MODELS",
  "QLING_LLM_STREAM_IDLE_MS",
  "QLING_FEATURES_WORKFLOW_RUNTIME",
  "QLING_FEATURES_SEMANTIC_MEMORY",
  "QLING_FEATURES_DYNAMIC_DISCOVERY",
  "QLING_FEATURES_RELIABILITY_V2",
  "QLING_REQUIRE_WORKSPACE_MUTATION",
  "QLING_RUN_MAX_COST_CNY",
];

function snapshotEnv() {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(previous) {
  for (const key of ENV_KEYS) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
}

function applyQuietEnv(maxRetries) {
  process.env.QLING_MEMORY_WAL_ENABLED = "false";
  process.env.QLING_METRICS_ENABLED = "false";
  process.env.QLING_AUTO_COMPACT = "false";
  process.env.QLING_VERIFY_LLM = "0";
  process.env.QLING_LLM_MAX_RETRIES = String(maxRetries);
  process.env.QLING_LLM_RETRY_BASE_MS = "100";
  process.env.QLING_LLM_RETRY_MAX_DELAY_MS = "200";
  process.env.QLING_LLM_RUN_RETRY_BUDGET = "20";
  process.env.QLING_LLM_STREAM_IDLE_MS = "0";
  delete process.env.QLING_MCP_SERVERS;
  delete process.env.QLING_LLM_FALLBACK_MODELS;
  delete process.env.QLING_FEATURES_WORKFLOW_RUNTIME;
  delete process.env.QLING_FEATURES_SEMANTIC_MEMORY;
  delete process.env.QLING_FEATURES_DYNAMIC_DISCOVERY;
  delete process.env.QLING_FEATURES_RELIABILITY_V2;
  delete process.env.QLING_REQUIRE_WORKSPACE_MUTATION;
  delete process.env.QLING_RUN_MAX_COST_CNY;
}

function createAgent(stateDir, options = {}) {
  const agent = new AgentLoop({
    apiKey: "test-key",
    model: "primary-model",
    maxIterations: options.maxIterations ?? 4,
    experimental: { streaming: Boolean(options.streaming) },
    runtime: {
      workspaceDir: stateDir,
      fileCacheDir: path.join(stateDir, "cache"),
      fileStateDir: stateDir,
      maxSteps: 4,
      parseRetries: 0,
      toolRepeatLimit: 4,
      timeoutMs: 5000,
      providerRetryLimit: options.providerRetryLimit,
    },
  });
  agent.checkAutoDream = async () => {};
  return agent;
}

test("model-retry agent: stream interruptions do not replay tool calls or keep partial assistant text", async () => {
  const previous = snapshotEnv();
  applyQuietEnv(5);
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-model-retry-agent-"));
  const agent = createAgent(stateDir, { streaming: true, providerRetryLimit: 5 });
  const logs = [];
  const originalError = console.error;
  console.error = (...args) => {
    logs.push(args.map((item) => String(item)).join(" "));
  };
  let calls = 0;
  let toolRuns = 0;
  const deltas = [];
  const models = [];
  try {
    agent.on("response_delta", (delta) => deltas.push(String(delta)));
    agent.llmClient.chatCompletions = async (input) => {
      calls++;
      models.push(input.model);
      assert.equal(input.messages.some((message) => message.role === "assistant" && String(message.content ?? "").includes("partial")), false);
      if (calls === 1) {
        return {
          content: "",
          finishReason: "tool_calls",
          tool_calls: [{
            id: "tool-1",
            type: "function",
            function: { name: "read", arguments: "{\"path\":\"README.md\"}" },
          }],
        };
      }
      if (calls <= 4) {
        input.onTextDelta?.("partial");
        throw Object.assign(new Error("grok gateway upstream stream error"), {
          code: "upstream_stream_error",
          retriable: true,
        });
      }
      return { content: "recovered", finishReason: "stop", streamed: true };
    };
    agent.pipeline.execute = async (toolCall) => {
      toolRuns++;
      return { tool_call_id: toolCall.id, output: "tool-ok" };
    };
    agent.addUserMessage("repair the stream");
    const outcome = await agent.runDetailed();
    assert.equal(outcome.status, "succeeded");
    assert.equal(outcome.text, "recovered");
    assert.equal(calls, 5);
    assert.equal(toolRuns, 1);
    assert.deepEqual(models, Array(5).fill("primary-model"));
    const messages = agent.getMessagesSnapshot();
    const assistants = messages.filter((message) => message.role === "assistant");
    assert.equal(assistants.length, 2);
    assert.equal(assistants.some((message) => String(message.content ?? "").includes("partial")), false);
    assert.equal(messages.filter((message) => message.role === "tool").length, 1);
    assert.match(messages.find((message) => message.role === "tool").content, /tool-ok/);
    assert.equal(deltas.filter((delta) => delta.includes("已丢弃上段输出")).length, 3);
    assert.ok(logs.some((line) => /retries=3/.test(line)));
  } finally {
    console.error = originalError;
    await agent.shutdown();
    await fs.rm(stateDir, { recursive: true, force: true });
    restoreEnv(previous);
  }
});

test("model-retry agent: exhausted provider failure checkpoints and resumes without repeating tools or interrupted-run reminders", async () => {
  const previous = snapshotEnv();
  applyQuietEnv(1);
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-model-retry-resume-"));
  const agent = createAgent(stateDir, { providerRetryLimit: 1 });
  let agent2;
  let calls = 0;
  let toolRuns = 0;
  try {
    agent.llmClient.chatCompletions = async () => {
      calls++;
      if (calls === 1) {
        return {
          content: "using tool",
          finishReason: "tool_calls",
          tool_calls: [{
            id: "tool-1",
            type: "function",
            function: { name: "read", arguments: "{\"path\":\"README.md\"}" },
          }],
        };
      }
      throw Object.assign(new Error("unavailable"), { status: 503, code: "server", retriable: true });
    };
    agent.pipeline.execute = async (toolCall) => {
      toolRuns++;
      return { tool_call_id: toolCall.id, output: "tool-ok" };
    };
    agent.addUserMessage("keep the tool result");
    const outcome = await agent.runDetailed();
    const sessionId = agent.getSessionId();
    assert.equal(outcome.status, "failed");
    assert.equal(calls, 3);
    assert.equal(toolRuns, 1);
    assert.match(outcome.text, new RegExp(sessionId));
    assert.match(outcome.text, new RegExp(`qling --resume ${sessionId}`));
    assert.match(outcome.text, new RegExp(`!load ${sessionId}`));
    const sessionFile = path.join(stateDir, "sessions", `${sessionId}.json`);
    const saved = JSON.parse(await fs.readFile(sessionFile, "utf8"));
    assert.equal(saved.activeRun ?? null, null);
    assert.equal(saved.messages.some((message) => message.role === "tool" && String(message.content).includes("tool-ok")), true);
    assert.equal(saved.messages.some((message) => String(message.content ?? "").includes(INTERRUPTED_RUN_REMINDER)), false);

    await agent.shutdown();
    agent2 = createAgent(stateDir, { providerRetryLimit: 1 });
    let resumedTools = 0;
    agent2.pipeline.execute = async () => {
      resumedTools++;
      return { output: "should-not-run" };
    };
    agent2.llmClient.chatCompletions = async () => ({ content: "continued", finishReason: "stop" });
    const restored = await agent2.restoreSession(sessionId);
    assert.ok(restored);
    assert.equal(
      agent2.getMessagesSnapshot().some((message) => String(message.content ?? "").includes(INTERRUPTED_RUN_REMINDER)),
      false,
    );
    agent2.addUserMessage("继续");
    const resumed = await agent2.runDetailed();
    assert.equal(resumed.status, "succeeded");
    assert.equal(resumed.text, "continued");
    assert.equal(resumedTools, 0);
  } finally {
    await agent.shutdown().catch(() => {});
    if (agent2) await agent2.shutdown();
    await fs.rm(stateDir, { recursive: true, force: true });
    restoreEnv(previous);
  }
});
