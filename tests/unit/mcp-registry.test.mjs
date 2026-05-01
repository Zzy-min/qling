// ============================================================
// MCP Registry 单元测试
// ============================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MCPRegistry } from "../../dist/mcp/registry.js";

describe("MCPRegistry", () => {
  it("should register servers", () => {
    const reg = new MCPRegistry();
    reg.registerServer({
      name: "test",
      command: "echo",
      args: [],
      enabled: true,
    });
    const status = reg.getStatus();
    assert.equal(status.test, "disconnected");
  });

  it("should report connected servers", () => {
    const reg = new MCPRegistry();
    reg.registerServer({
      name: "test",
      command: "echo",
      args: [],
      enabled: true,
    });
    const connected = reg.getConnectedServers();
    assert.deepEqual(connected, []);
  });

  it("should handle connect failure gracefully", async () => {
    const reg = new MCPRegistry({ connection: 1000 });
    reg.registerServer({
      name: "nonexistent",
      command: "nonexistent_command_xyz",
      args: [],
      enabled: true,
    });
    const result = await reg.connectServer("nonexistent");
    assert.equal(result.status, "failed");
    assert.ok(result.error);
  });

  it("should return empty tools when no servers connected", () => {
    const reg = new MCPRegistry();
    const tools = reg.getAllTools();
    assert.deepEqual(tools, []);
  });

  it("should handle callTool for disconnected server", async () => {
    const reg = new MCPRegistry();
    const result = await reg.callTool("missing", "tool", {});
    assert.equal(result.is_error, true);
    assert.ok(result.output.includes("not connected"));
  });

  it("should handle connectAll with no servers", async () => {
    const reg = new MCPRegistry();
    const results = await reg.connectAll();
    assert.deepEqual(results, []);
  });

  it("should handle connectServer for unregistered server", async () => {
    const reg = new MCPRegistry();
    const result = await reg.connectServer("missing");
    assert.equal(result.status, "failed");
  });

  it("should disconnect all cleanly", async () => {
    const reg = new MCPRegistry();
    reg.registerServer({
      name: "test",
      command: "echo",
      args: [],
      enabled: true,
    });
    await reg.disconnectAll();
    assert.deepEqual(reg.getConnectedServers(), []);
  });
});
