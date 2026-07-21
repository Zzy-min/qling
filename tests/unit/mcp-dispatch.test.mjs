// ============================================================
// MCP Dispatch 单元测试
// ============================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createToolDispatcher, dispatch } from "../../dist/tools/index.js";

describe("MCP Dispatch", () => {
  it("binds each dispatcher to its own MCP registry", async () => {
    const callsA = [];
    const callsB = [];
    const registry = (label, calls) => ({
      callTool: async (server, tool, args) => {
        calls.push({ server, tool, args });
        return { tool_call_id: "inner", output: label, is_error: false };
      },
    });
    const dispatchA = createToolDispatcher({ mcpRegistry: registry("A", callsA) });
    const dispatchB = createToolDispatcher({ mcpRegistry: registry("B", callsB) });

    const [resultA, resultB] = await Promise.all([
      dispatchA({ id: "a", name: "mcp__same__echo", arguments: { value: 1 } }),
      dispatchB({ id: "b", name: "mcp__same__echo", arguments: { value: 2 } }),
    ]);

    assert.equal(resultA.output, "A");
    assert.equal(resultB.output, "B");
    assert.equal(resultA.tool_call_id, "a");
    assert.equal(resultB.tool_call_id, "b");
    assert.equal(callsA[0].args.value, 1);
    assert.equal(callsB[0].args.value, 2);
  });

  it("default dispatch has no ambient MCP registry", async () => {
    const result = await dispatch({
      id: "test-2",
      name: "mcp__test__some_tool",
      arguments: {},
    });

    assert.equal(result.is_error, true);
    assert.ok(result.output.includes("unknown tool") || result.output.includes("TOOL_NOT_FOUND"));
  });
});
