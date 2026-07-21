// ============================================================
// Guard M2: 工具权限矩阵单元测试
// ============================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PermissionMatrix,
  buildSafeAutoAllowRules,
} from "../../dist/guard/permissions.js";

describe("PermissionMatrix", () => {
  it("safe auto-allow rules keep todo/read under default ask", () => {
    const matrix = new PermissionMatrix("ask", buildSafeAutoAllowRules());
    assert.equal(matrix.evaluate("todo").decision, "allow");
    assert.equal(matrix.evaluate("read").decision, "allow");
    assert.equal(matrix.evaluate("search").decision, "allow");
    assert.equal(matrix.evaluate("bash").decision, "ask");
    assert.equal(matrix.evaluate("write").decision, "ask");
    assert.equal(matrix.evaluate("url_fetch").decision, "ask");
  });

  it("user deny beats safe auto-allow when listed first", () => {
    const matrix = new PermissionMatrix("ask", [
      { tool_pattern: "todo", decision: "deny", reason: "user ban" },
      ...buildSafeAutoAllowRules(),
    ]);
    assert.equal(matrix.evaluate("todo").decision, "deny");
    assert.equal(matrix.evaluate("read").decision, "allow");
  });

  it("should return default allow when no rules", () => {
    const matrix = new PermissionMatrix("allow", []);
    const result = matrix.evaluate("bash");
    assert.equal(result.decision, "allow");
    assert.equal(result.matched_rule, undefined);
  });

  it("should return default deny when no rules match", () => {
    const matrix = new PermissionMatrix("deny", []);
    const result = matrix.evaluate("bash");
    assert.equal(result.decision, "deny");
  });

  it("should match exact tool name", () => {
    const matrix = new PermissionMatrix("allow", [
      { tool_pattern: "bash", decision: "deny", reason: "bash not allowed" },
    ]);
    const result = matrix.evaluate("bash");
    assert.equal(result.decision, "deny");
    assert.equal(result.reason, "bash not allowed");
    assert.equal(result.matched_rule, "bash");
  });

  it("should not match different tool", () => {
    const matrix = new PermissionMatrix("allow", [
      { tool_pattern: "bash", decision: "deny" },
    ]);
    const result = matrix.evaluate("read");
    assert.equal(result.decision, "allow");
  });

  it("should match wildcard *", () => {
    const matrix = new PermissionMatrix("allow", [
      { tool_pattern: "*", decision: "ask" },
    ]);
    assert.equal(matrix.evaluate("bash").decision, "ask");
    assert.equal(matrix.evaluate("read").decision, "ask");
    assert.equal(matrix.evaluate("write").decision, "ask");
  });

  it("should match glob pattern mcp__*", () => {
    const matrix = new PermissionMatrix("allow", [
      { tool_pattern: "mcp__*", decision: "deny" },
    ]);
    assert.equal(matrix.evaluate("mcp__github__search").decision, "deny");
    assert.equal(matrix.evaluate("mcp__slack__send").decision, "deny");
    assert.equal(matrix.evaluate("bash").decision, "allow");
  });

  it("should match ? wildcard", () => {
    const matrix = new PermissionMatrix("allow", [
      { tool_pattern: "ba?h", decision: "deny" },
    ]);
    assert.equal(matrix.evaluate("bash").decision, "deny");
    assert.equal(matrix.evaluate("baah").decision, "deny");
    assert.equal(matrix.evaluate("bath").decision, "deny");
    assert.equal(matrix.evaluate("read").decision, "allow");
  });

  it("should use first matching rule (priority)", () => {
    const matrix = new PermissionMatrix("allow", [
      { tool_pattern: "bash", decision: "ask" },
      { tool_pattern: "bash", decision: "deny" },
    ]);
    assert.equal(matrix.evaluate("bash").decision, "ask");
  });

  it("should fall through to later rules if no match", () => {
    const matrix = new PermissionMatrix("allow", [
      { tool_pattern: "write", decision: "deny" },
      { tool_pattern: "bash", decision: "ask" },
    ]);
    assert.equal(matrix.evaluate("bash").decision, "ask");
    assert.equal(matrix.evaluate("write").decision, "deny");
    assert.equal(matrix.evaluate("read").decision, "allow");
  });

  it("should handle complex glob patterns", () => {
    const matrix = new PermissionMatrix("allow", [
      { tool_pattern: "mcp__*__send", decision: "ask" },
    ]);
    assert.equal(matrix.evaluate("mcp__slack__send").decision, "ask");
    assert.equal(matrix.evaluate("mcp__telegram__send").decision, "ask");
    assert.equal(matrix.evaluate("mcp__slack__read").decision, "allow");
    assert.equal(matrix.evaluate("send").decision, "allow");
  });
});
