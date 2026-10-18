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
    // 未声明 annotations → 默认非只读（安全默认）
    assert.equal(native[0].readOnly, false);
    assert.equal(native[0].destructive, false);
    assert.equal(native[1].name, "mcp__db__query");
    assert.equal(native[1].readOnly, false);
  });

  it("maps annotations.readOnlyHint / destructiveHint strictly by === true", () => {
    const native = mcpToolsToNativeDefinitions([
      {
        serverName: "fs",
        name: "read",
        description: "r",
        inputSchema: {},
        annotations: { readOnlyHint: true },
      },
      {
        serverName: "fs",
        name: "write",
        description: "w",
        inputSchema: {},
        annotations: { readOnlyHint: false, destructiveHint: true },
      },
      {
        serverName: "fs",
        name: "maybe",
        description: "m",
        inputSchema: {},
        // 非布尔 / 缺省一律视为非只读
        annotations: { readOnlyHint: "true" },
      },
    ]);

    assert.equal(native[0].readOnly, true);
    assert.equal(native[0].destructive, false);
    assert.equal(native[1].readOnly, false);
    assert.equal(native[1].destructive, true);
    assert.equal(native[2].readOnly, false);
  });
});
