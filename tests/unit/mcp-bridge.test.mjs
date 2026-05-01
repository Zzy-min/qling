// ============================================================
// MCP Bridge 单元测试
// ============================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mcpToolFullName,
  isMCPTool,
  parseMCPToolName,
  mcpToolsToNativeDefinitions,
} from "../../dist/mcp/bridge.js";

describe("MCP Bridge", () => {
  it("should create full tool name with prefix", () => {
    assert.equal(mcpToolFullName("filesystem", "read_file"), "mcp__filesystem__read_file");
  });

  it("should detect MCP tool names", () => {
    assert.ok(isMCPTool("mcp__filesystem__read_file"));
    assert.ok(isMCPTool("mcp__foo__bar"));
    assert.ok(!isMCPTool("read"));
    assert.ok(!isMCPTool("bash"));
    assert.ok(!isMCPTool("mcp_read"));
  });

  it("should parse MCP tool names", () => {
    const parsed = parseMCPToolName("mcp__filesystem__read_file");
    assert.equal(parsed?.serverName, "filesystem");
    assert.equal(parsed?.toolName, "read_file");
  });

  it("should return null for non-MCP tools", () => {
    assert.equal(parseMCPToolName("read"), null);
    assert.equal(parseMCPToolName("mcp_read"), null);
  });

  it("should convert MCP tools to native definitions", () => {
    const mcpTools = [
      { serverName: "fs", name: "read", description: "Read a file", inputSchema: { type: "object" } },
      { serverName: "db", name: "query", description: "Run a query", inputSchema: { type: "object" } },
    ];
    const native = mcpToolsToNativeDefinitions(mcpTools);

    assert.equal(native.length, 2);
    assert.equal(native[0].name, "mcp__fs__read");
    assert.ok(native[0].description.includes("[MCP:fs]"));
    assert.equal(native[0].readOnly, true);
    assert.equal(native[1].name, "mcp__db__query");
  });
});
