import test from "node:test";
import assert from "node:assert/strict";

import { AgentLoop } from "../../dist/agent-loop.js";

function snapshotEnv() {
  return {
    wal: process.env.QLING_MEMORY_WAL_ENABLED,
    metrics: process.env.QLING_METRICS_ENABLED,
    mcp: process.env.QLING_MCP_SERVERS,
    llmTimeout: process.env.QLING_LLM_REQUEST_TIMEOUT_MS,
  };
}

function restoreEnv(prev) {
  if (prev.wal === undefined) delete process.env.QLING_MEMORY_WAL_ENABLED;
  else process.env.QLING_MEMORY_WAL_ENABLED = prev.wal;
  if (prev.metrics === undefined) delete process.env.QLING_METRICS_ENABLED;
  else process.env.QLING_METRICS_ENABLED = prev.metrics;
  if (prev.mcp === undefined) delete process.env.QLING_MCP_SERVERS;
  else process.env.QLING_MCP_SERVERS = prev.mcp;
  if (prev.llmTimeout === undefined) delete process.env.QLING_LLM_REQUEST_TIMEOUT_MS;
  else process.env.QLING_LLM_REQUEST_TIMEOUT_MS = prev.llmTimeout;
}

test("agent-loop: tool arguments tolerate loose json within parse retries", async () => {
  const prev = snapshotEnv();
  process.env.QLING_MEMORY_WAL_ENABLED = "false";
  process.env.QLING_METRICS_ENABLED = "false";
  delete process.env.QLING_MCP_SERVERS;

  const agent = new AgentLoop({
    apiKey: "test-key",
    maxIterations: 3,
    runtime: {
      workspaceDir: process.cwd(),
      fileCacheDir: process.cwd(),
      fileStateDir: process.cwd(),
      maxSteps: 3,
      parseRetries: 3,
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
  process.env.QLING_MEMORY_WAL_ENABLED = "false";
  process.env.QLING_METRICS_ENABLED = "false";
  delete process.env.QLING_MCP_SERVERS;

  const agent = new AgentLoop({
    apiKey: "test-key",
    maxIterations: 3,
    runtime: {
      workspaceDir: process.cwd(),
      fileCacheDir: process.cwd(),
      fileStateDir: process.cwd(),
      maxSteps: 3,
      parseRetries: 1,
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
  process.env.QLING_MEMORY_WAL_ENABLED = "false";
  process.env.QLING_METRICS_ENABLED = "false";
  delete process.env.QLING_MCP_SERVERS;

  const agent = new AgentLoop({
    apiKey: "test-key",
    maxIterations: 3,
    runtime: {
      workspaceDir: process.cwd(),
      fileCacheDir: process.cwd(),
      fileStateDir: process.cwd(),
      maxSteps: 3,
      parseRetries: 1,
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

    const events = [];
    const unsubscribe = agent.subscribeExecutionEvents((event) => events.push(event));

    agent.addUserMessage("run repeat limit test");
    const finalAnswer = await agent.run();

    assert.match(finalAnswer, /执行已暂停/);
    assert.match(finalAnswer, /repeated_action/);
    assert.equal(pipelineCalls, 0);
    const toolMessages = agent.messages.filter((m) => m.role === "tool");
    assert.equal(toolMessages.length, 0);
    assert.equal(events.filter((event) => event.type === "loop_detected").length, 1);
    unsubscribe();
  } finally {
    await agent.shutdown();
    restoreEnv(prev);
  }
});

test("agent-loop: llm request timeout uses QLING_LLM_REQUEST_TIMEOUT_MS", async () => {
  const prev = snapshotEnv();
  process.env.QLING_MEMORY_WAL_ENABLED = "false";
  process.env.QLING_METRICS_ENABLED = "false";
  delete process.env.QLING_MCP_SERVERS;
  process.env.QLING_LLM_REQUEST_TIMEOUT_MS = "4321";

  const agent = new AgentLoop({
    apiKey: "test-key",
  });

  try {
    assert.equal(agent.llmClient.getTimeoutMs(), 4321);
  } finally {
    await agent.shutdown();
    restoreEnv(prev);
  }
});

test("agent-loop: session token stats prefer provider usage total tokens", async () => {
  const prev = snapshotEnv();
  process.env.QLING_MEMORY_WAL_ENABLED = "false";
  process.env.QLING_METRICS_ENABLED = "false";
  delete process.env.QLING_MCP_SERVERS;

  const agent = new AgentLoop({
    apiKey: "test-key",
    maxIterations: 1,
    runtime: {
      workspaceDir: process.cwd(),
      fileCacheDir: process.cwd(),
      fileStateDir: process.cwd(),
      maxSteps: 1,
      parseRetries: 1,
      toolRepeatLimit: 6,
      timeoutMs: 60000,
    },
  });

  try {
    agent.checkAutoDream = async () => {};
    agent.llmClient.chatCompletions = async () => ({
      content: "done",
      usage: {
        promptTokens: 111,
        completionTokens: 210,
        totalTokens: 321,
      },
    });

    agent.addUserMessage("tiny");
    const finalAnswer = await agent.run();

    assert.equal(finalAnswer, "done");
    assert.equal(agent.getSessionStats().tokens, 321);
    assert.equal(agent.getSessionStats().promptTokens, 111);
    assert.equal(agent.getSessionStats().completionTokens, 210);
    assert.equal(agent.getSessionStats().tokenSource, "provider");
  } finally {
    await agent.shutdown();
    restoreEnv(prev);
  }
});

test("agent-loop: session token stats stay unknown when provider usage is missing", async () => {
  const prev = snapshotEnv();
  process.env.QLING_MEMORY_WAL_ENABLED = "false";
  process.env.QLING_METRICS_ENABLED = "false";
  delete process.env.QLING_MCP_SERVERS;

  const agent = new AgentLoop({
    apiKey: "test-key",
    maxIterations: 1,
    runtime: {
      workspaceDir: process.cwd(),
      fileCacheDir: process.cwd(),
      fileStateDir: process.cwd(),
      maxSteps: 1,
      parseRetries: 1,
      toolRepeatLimit: 6,
      timeoutMs: 60000,
    },
  });

  try {
    agent.checkAutoDream = async () => {};
    agent.llmClient.chatCompletions = async () => ({
      content: "done",
    });

    agent.addUserMessage("no usage fields");
    const finalAnswer = await agent.run();

    assert.equal(finalAnswer, "done");
    assert.equal(agent.getSessionStats().tokens, 0);
    assert.equal(agent.getSessionStats().promptTokens, 0);
    assert.equal(agent.getSessionStats().completionTokens, 0);
    assert.equal(agent.getSessionStats().tokenSource, "unknown");
  } finally {
    await agent.shutdown();
    restoreEnv(prev);
  }
});
