// ============================================================
// E2E: Guard M2 集成（权限拒绝 + 内容过滤）
// 使用 AgentLoop 直接实例化 + monkey-patch
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";

import { AgentLoop } from "../../dist/agent-loop.js";

function withGuardEnv(overrides, fn) {
  return async () => {
    const saved = {};
    for (const [k, v] of Object.entries(overrides)) {
      saved[k] = process.env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      await fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };
}

test("e2e guard m2: permission deny blocks bash tool", withGuardEnv({
  QINGLING_MEMORY_WAL_ENABLED: "false",
  QINGLING_METRICS_ENABLED: "false",
  QINGLING_GUARD_ENABLED: "true",
  QINGLING_GUARD_PERMISSIONS_DEFAULT: "allow",
  QINGLING_GUARD_PERMISSIONS_RULES: JSON.stringify([
    { tool_pattern: "bash", decision: "deny", reason: "bash is forbidden in this session" },
  ]),
  QINGLING_GUARD_RATE_LIMIT_ENABLED: "false",
  QINGLING_GUARD_CONTENT_FILTER_ENABLED: "false",
}, async () => {
  const agent = new AgentLoop({
    apiKey: "test-key",
    maxIterations: 3,
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
          tool_calls: [{
            id: "tc-bash-1",
            type: "function",
            function: {
              name: "bash",
              arguments: JSON.stringify({ command: "echo hello" }),
            },
          }],
        };
      }
      return { content: "done after permission check" };
    };

    // Don't patch pipeline.execute — let the real pipeline run with guard
    agent.addUserMessage("run a bash command");
    const result = await agent.run();

    // The tool result should contain permission denied message
    const toolMessages = agent.messages.filter((m) => m.role === "tool");
    assert.ok(toolMessages.length > 0, "should have tool result messages");
    const toolResult = JSON.parse(toolMessages[0].content);
    assert.equal(toolResult.is_error, true, "tool should be marked as error");
    assert.match(toolResult.output, /权限拒绝|Permission|denied/i, "should contain permission denial message");
  } finally {
    await agent.shutdown();
  }
}));

test("e2e guard m2: content filter blocks PII in tool output", withGuardEnv({
  QINGLING_MEMORY_WAL_ENABLED: "false",
  QINGLING_METRICS_ENABLED: "false",
  QINGLING_GUARD_ENABLED: "true",
  QINGLING_GUARD_CONTENT_FILTER_ENABLED: "true",
  QINGLING_GUARD_CONTENT_FILTER_PII: "true",
  QINGLING_GUARD_CONTENT_FILTER_INJECTION: "true",
  QINGLING_GUARD_RATE_LIMIT_ENABLED: "false",
}, async () => {
  const agent = new AgentLoop({
    apiKey: "test-key",
    maxIterations: 3,
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
          tool_calls: [{
            id: "tc-read-1",
            type: "function",
            function: {
              name: "read",
              arguments: JSON.stringify({ path: "some-file.txt" }),
            },
          }],
        };
      }
      return { content: "done after content filter" };
    };

    // Patch pipeline.execute to return output containing PII
    agent.pipeline.execute = async (toolCall) => ({
      tool_call_id: toolCall.id,
      output: "user contact: 13812345678, email: test@example.com",
    });

    agent.addUserMessage("read a file with PII");
    await agent.run();

    // The tool message should be replaced by content filter
    const toolMessages = agent.messages.filter((m) => m.role === "tool");
    assert.ok(toolMessages.length > 0, "should have tool result messages");
    const toolResult = JSON.parse(toolMessages[0].content);
    assert.equal(toolResult.is_error, true, "filtered output should be marked as error");
    assert.match(toolResult.output, /内容过滤/, "output should be replaced by content filter message");
    assert.match(toolResult.error?.code ?? "", /CONTENT_FILTERED/, "error code should be CONTENT_FILTERED");
  } finally {
    await agent.shutdown();
  }
}));
