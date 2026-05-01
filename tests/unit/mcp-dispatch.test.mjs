// ============================================================
// MCP Dispatch 单元测试
// ============================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dispatch, setMCPRegistry, getMCPRegistry } from "../../dist/tools/index.js";
import { MCPRegistry } from "../../dist/mcp/registry.js";

describe("MCP Dispatch", () => {
  it("should route mcp__ tools when registry is set", async () => {
    const reg = new MCPRegistry();
    // We don't connect any real server, so the call will fail with "not connected"
    setMCPRegistry(reg);

    const result = await dispatch({
      id: "test-1",
      name: "mcp__test__some_tool",
      arguments: { foo: "bar" },
    });

    assert.equal(result.is_error, true);
    assert.ok(result.output.includes("not connected"));

    setMCPRegistry(null);
  });

  it("should not route mcp__ tools when registry is null", async () => {
    setMCPRegistry(null);

    const result = await dispatch({
      id: "test-2",
      name: "mcp__test__some_tool",
      arguments: {},
    });

    // Should fall through to unknown tool
    assert.equal(result.is_error, true);
    assert.ok(result.output.includes("unknown tool") || result.output.includes("TOOL_NOT_FOUND"));
  });
});
