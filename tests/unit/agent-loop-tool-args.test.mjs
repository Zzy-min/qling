import test from "node:test";
import assert from "node:assert/strict";

import { AgentLoop } from "../../dist/agent-loop.js";

function snapshotEnv() {
  return {
    wal: process.env.QINGLING_MEMORY_WAL_ENABLED,
    metrics: process.env.QINGLING_METRICS_ENABLED,
    mcp: process.env.QINGLING_MCP_SERVERS,
    llmTimeout: process.env.QINGLING_LLM_REQUEST_TIMEOUT_MS,
  };
}

function restoreEnv(prev) {
  if (prev.wal === undefined) delete process.env.QINGLING_MEMORY_WAL_ENABLED;
  else process.env.QINGLING_MEMORY_WAL_ENABLED = prev.wal;
  if (prev.metrics === undefined) delete process.env.QINGLING_METRICS_ENABLED;
  else process.env.QINGLING_METRICS_ENABLED = prev.metrics;
  if (prev.mcp === undefined) delete process.env.QINGLING_MCP_SERVERS;
  else process.env.QINGLING_MCP_SERVERS = prev.mcp;
  if (prev.llmTimeout === undefined) delete process.env.QINGLING_LLM_REQUEST_TIMEOUT_MS;
  else process.env.QINGLING_LLM_REQUEST_TIMEOUT_MS = prev.llmTimeout;
}

test("agent-loop: tool arguments tolerate loose json within parse retries", async () => {
  const prev = snapshotEnv();
  process.env.QINGLING_MEMORY_WAL_ENABLED = "false";
  process.env.QINGLING_METRICS_ENABLED = "false";
  delete process.env.QINGLING_MCP_SERVERS;

  const agent = new AgentLoop({
    apiKey: "test-key",
    maxIterations: 3,
    runtime: {
      workspaceDir: process.cwd(),
      fileCacheDir: process.cwd(),
      fileStateDir: process.cwd(),
      maxSteps: 3,
      parseRetries: 3,
      maxTokenBudget: 120000,
      toolRepeatLimit: 6,
      timeoutMs: 60000,
    },
  });

  try {
    agent.checkAutoDream = async () => {};
    agent.verifyLastOperation = async () => {};

    const executed = [];
    let call = 0;
    agent.chat = async () => {
      if (call === 0) {
        call++;
        return {
          content: "",
          tool_calls: [
            {
              id: "tc-1",
              type: "function",
              function: {
                name: "read",
                arguments: "{'path':'README.md',}",
              },
            },
          ],
        };
      }
      return { content: "done" };
    };

    agent.pipeline.execute = async (toolCall) => {
      executed.push(toolCall);
      return { tool_call_id: toolCall.id, output: "ok" };
    };

    agent.addUserMessage("run parse tolerance test");
    const finalAnswer = await agent.run();

    assert.equal(finalAnswer, "done");
    assert.equal(executed.length, 1);
    assert.equal(executed[0].arguments.path, "README.md");
  } finally {
    await agent.shutdown();
    restoreEnv(prev);
  }
});

test("agent-loop: invalid tool arguments become tool error instead of crashing", async () => {
  const prev = snapshotEnv();
  process.env.QINGLING_MEMORY_WAL_ENABLED = "false";
  process.env.QINGLING_METRICS_ENABLED = "false";
  delete process.env.QINGLING_MCP_SERVERS;

  const agent = new AgentLoop({
    apiKey: "test-key",
    maxIterations: 3,
    runtime: {
      workspaceDir: process.cwd(),
      fileCacheDir: process.cwd(),
      fileStateDir: process.cwd(),
      maxSteps: 3,
      parseRetries: 1,
      maxTokenBudget: 120000,
      toolRepeatLimit: 6,
      timeoutMs: 60000,
    },
  });

  try {
    agent.checkAutoDream = async () => {};
    agent.verifyLastOperation = async () => {};

    let call = 0;
    agent.chat = async () => {
      if (call === 0) {
        call++;
        return {
          content: "",
          tool_calls: [
            {
              id: "tc-bad",
              type: "function",
              function: {
                name: "read",
                arguments: "{path:",
              },
            },
          ],
        };
      }
      return { content: "done-after-error" };
    };

    agent.pipeline.execute = async () => {
      throw new Error("pipeline should not be called for malformed arguments");
    };

    agent.addUserMessage("run malformed parse test");
    const finalAnswer = await agent.run();

    assert.equal(finalAnswer, "done-after-error");
    const toolMessages = agent.messages.filter((m) => m.role === "tool");
    assert.equal(toolMessages.length, 1);
    assert.match(toolMessages[0].content, /TOOL_INVALID_ARGUMENTS/);
  } finally {
    await agent.shutdown();
    restoreEnv(prev);
  }
});

test("agent-loop: tool repeat limit blocks repeated identical calls", async () => {
  const prev = snapshotEnv();
  process.env.QINGLING_MEMORY_WAL_ENABLED = "false";
  process.env.QINGLING_METRICS_ENABLED = "false";
  delete process.env.QINGLING_MCP_SERVERS;

  const agent = new AgentLoop({
    apiKey: "test-key",
    maxIterations: 3,
    runtime: {
      workspaceDir: process.cwd(),
      fileCacheDir: process.cwd(),
      fileStateDir: process.cwd(),
      maxSteps: 3,
      parseRetries: 1,
      maxTokenBudget: 120000,
      toolRepeatLimit: 1,
      timeoutMs: 60000,
    },
  });

  try {
    agent.checkAutoDream = async () => {};
    agent.verifyLastOperation = async () => {};

    let call = 0;
    let pipelineCalls = 0;
    agent.chat = async () => {
      if (call === 0) {
        call++;
        return {
          content: "",
          tool_calls: [
            {
              id: "tc-1",
              type: "function",
              function: {
                name: "read",
                arguments: JSON.stringify({ path: "README.md" }),
              },
            },
            {
              id: "tc-2",
              type: "function",
              function: {
                name: "read",
                arguments: JSON.stringify({ path: "README.md" }),
              },
            },
          ],
        };
      }
      return { content: "done-repeat-limit" };
    };

    agent.pipeline.execute = async (toolCall) => {
      pipelineCalls++;
      return { tool_call_id: toolCall.id, output: "ok" };
    };

    agent.addUserMessage("run repeat limit test");
    const finalAnswer = await agent.run();

    assert.equal(finalAnswer, "done-repeat-limit");
    assert.equal(pipelineCalls, 1);
    const toolMessages = agent.messages.filter((m) => m.role === "tool");
    assert.equal(toolMessages.length, 2);
    assert.match(toolMessages[1].content, /TOOL_REPEAT_LIMIT_EXCEEDED/);
  } finally {
    await agent.shutdown();
    restoreEnv(prev);
  }
});

test("agent-loop: llm request timeout uses QINGLING_LLM_REQUEST_TIMEOUT_MS", async () => {
  const prev = snapshotEnv();
  process.env.QINGLING_MEMORY_WAL_ENABLED = "false";
  process.env.QINGLING_METRICS_ENABLED = "false";
  delete process.env.QINGLING_MCP_SERVERS;
  process.env.QINGLING_LLM_REQUEST_TIMEOUT_MS = "4321";

  const agent = new AgentLoop({
    apiKey: "test-key",
  });

  try {
    assert.equal(agent.client.defaults.timeout, 4321);
  } finally {
    await agent.shutdown();
    restoreEnv(prev);
  }
});
