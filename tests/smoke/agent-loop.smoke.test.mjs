import test from "node:test";
import assert from "node:assert/strict";

import { AgentLoop } from "../../dist/agent-loop.js";

test("agent-loop smoke: preserves user -> assistant(tool_calls) -> tool -> assistant chain", async () => {
  const prevWal = process.env.QINGLING_MEMORY_WAL_ENABLED;
  const prevMetrics = process.env.QINGLING_METRICS_ENABLED;
  const prevMcp = process.env.QINGLING_MCP_SERVERS;
  process.env.QINGLING_MEMORY_WAL_ENABLED = "false";
  process.env.QINGLING_METRICS_ENABLED = "false";
  delete process.env.QINGLING_MCP_SERVERS;

  const agent = new AgentLoop({
    apiKey: "test-key",
    maxIterations: 3,
  });

  try {
    // 避免测试依赖外部 API/持久化副作用
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
              id: "tc-1",
              type: "function",
              function: {
                name: "read",
                arguments: JSON.stringify({ path: "README.md" }),
              },
            },
          ],
        };
      }
      return { content: "done" };
    };

    agent.pipeline.execute = async (toolCall) => ({
      tool_call_id: toolCall.id,
      output: "ok",
    });

    agent.addUserMessage("run smoke");
    const finalAnswer = await agent.run();

    assert.equal(finalAnswer, "done");

    const messages = agent.messages;
    const assistantWithCallIdx = messages.findIndex(
      (m) => m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0
    );
    const toolIdx = messages.findIndex((m) => m.role === "tool");
    let finalAssistantIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "assistant" && (!msg.tool_calls || msg.tool_calls.length === 0)) {
        finalAssistantIdx = i;
        break;
      }
    }

    assert.ok(assistantWithCallIdx >= 0, "assistant tool call message should exist");
    assert.ok(toolIdx > assistantWithCallIdx, "tool message should appear after assistant tool call");
    assert.ok(finalAssistantIdx > toolIdx, "final assistant message should appear after tool output");
  } finally {
    await agent.shutdown();
    if (prevWal === undefined) delete process.env.QINGLING_MEMORY_WAL_ENABLED;
    else process.env.QINGLING_MEMORY_WAL_ENABLED = prevWal;
    if (prevMetrics === undefined) delete process.env.QINGLING_METRICS_ENABLED;
    else process.env.QINGLING_METRICS_ENABLED = prevMetrics;
    if (prevMcp === undefined) delete process.env.QINGLING_MCP_SERVERS;
    else process.env.QINGLING_MCP_SERVERS = prevMcp;
  }
});
