// ============================================================
// MCP 只读标记 + Plan Mode 拦截 安全回归测试
// ============================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  HookManager,
  PLAN_MODE_DENY_TOOLS,
  PLAN_MODE_HARD_DENY_TOOLS,
} from "../../dist/pipeline/hooks.js";

function guard() {
  return {
    enabled: true,
    network: {
      url_fetch: { allowed_url_prefixes: ["https://"], deny_private_ips: true, follow_redirects: false },
    },
    redaction: { enabled: false, patterns: [] },
    audit: { jsonl_path: "" },
    rate_limit: { enabled: false, max_per_minute: 0 },
    content_filter: { enabled: false, pii_detection: false, injection_detection: false, custom_patterns: [] },
    permissions: { default: "allow", rules: [] },
  };
}

function toolDefs() {
  return [
    { name: "read", description: "r", parameters: { type: "object", properties: {} }, readOnly: true },
    { name: "write", description: "w", parameters: { type: "object", properties: {} }, readOnly: false },
    { name: "patch", description: "p", parameters: { type: "object", properties: {} }, readOnly: false },
    { name: "bash", description: "b", parameters: { type: "object", properties: {} }, readOnly: false },
    { name: "subtask", description: "s", parameters: { type: "object", properties: {} }, readOnly: false },
    { name: "bg_reconcile", description: "br", parameters: { type: "object", properties: {} }, readOnly: false },
    { name: "browser_fetch", description: "bf", parameters: { type: "object", properties: {} }, readOnly: false },
    { name: "browser_act", description: "ba", parameters: { type: "object", properties: {} }, readOnly: false },
    { name: "use_tool", description: "ut", parameters: { type: "object", properties: {} }, readOnly: false },
    // 声明 readOnlyHint 的 MCP 只读工具
    { name: "mcp__fs__read", description: "mr", parameters: { type: "object", properties: {} }, readOnly: true },
    // 未声明（或 readOnlyHint!==true）的 MCP 写工具
    { name: "mcp__db__write", description: "mw", parameters: { type: "object", properties: {} }, readOnly: false },
  ];
}

function ctx(toolName, extra = {}) {
  return {
    toolName,
    arguments: extra.arguments ?? {},
    inputSchema: {},
    isReadOnly: extra.isReadOnly ?? (toolName.startsWith("mcp__") ? toolName.endsWith("read") : true),
    isDestructive: extra.isDestructive ?? false,
    isConcurrencySafe: true,
    dangerousPatterns: extra.dangerousPatterns ?? [],
  };
}

describe("Plan Mode hard-deny safety", () => {
  it("keeps every original PLAN_MODE_HARD_DENY_TOOL denied", async () => {
    const hm = new HookManager(toolDefs(), guard());
    hm.setWorkspaceDir(process.cwd());
    hm.setPlanMode(true);
    for (const tool of PLAN_MODE_HARD_DENY_TOOLS) {
      const result = await hm.runPreHook(ctx(tool, { isReadOnly: false }));
      assert.equal(result.decision, "deny", `${tool} must be denied in plan mode`);
    }
  });

  it("still denies previously-denied write/patch/bash paths", async () => {
    const hm = new HookManager(toolDefs(), guard());
    hm.setWorkspaceDir(process.cwd());
    hm.setPlanMode(true);
    assert.ok(PLAN_MODE_DENY_TOOLS.includes("write"));
    assert.ok(PLAN_MODE_DENY_TOOLS.includes("patch"));
    assert.ok(PLAN_MODE_DENY_TOOLS.includes("bash"));

    const write = await hm.runPreHook(ctx("write", { arguments: { path: "src/app.ts", content: "x" }, isReadOnly: false }));
    assert.equal(write.decision, "deny");
    const patch = await hm.runPreHook(ctx("patch", { arguments: { path: "src/app.ts" }, isReadOnly: false }));
    assert.equal(patch.decision, "deny");
  });

  it("denies non-readonly MCP tools and use_tool in plan mode", async () => {
    const hm = new HookManager(toolDefs(), guard());
    hm.setWorkspaceDir(process.cwd());
    hm.setPlanMode(true);

    const mcpWrite = await hm.runPreHook(ctx("mcp__db__write", { isReadOnly: false }));
    assert.equal(mcpWrite.decision, "deny");
    assert.match(String(mcpWrite.blockingError), /MCP|Plan Mode/i);

    const useTool = await hm.runPreHook(ctx("use_tool", { isReadOnly: false }));
    assert.equal(useTool.decision, "deny");
  });

  it("allows MCP tools that declare readOnlyHint:true", async () => {
    const hm = new HookManager(toolDefs(), guard());
    hm.setWorkspaceDir(process.cwd());
    hm.setPlanMode(true);

    const mcpRead = await hm.runPreHook(ctx("mcp__fs__read", { isReadOnly: true }));
    assert.equal(mcpRead.decision, "allow");
  });
});

describe("Non-plan-mode decisions are unchanged (not looser)", () => {
  // 固定改动前的 deny>ask>allow 期望值。
  const expected = [
    ["read", { arguments: { path: "a.ts" } }, "allow"],
    ["write", { arguments: { path: "a.ts", content: "x" }, isReadOnly: false }, "allow"],
    ["patch", { arguments: { path: "a.ts" }, isReadOnly: false }, "allow"],
    ["bash", { arguments: { command: "echo hi" }, isReadOnly: false }, "allow"],
    ["bash", { arguments: { command: "rm -rf /" }, isReadOnly: false }, "deny"],
    ["mcp__fs__read", { isReadOnly: true }, "allow"],
    ["mcp__db__write", { isReadOnly: false }, "allow"],
    ["use_tool", { isReadOnly: false }, "allow"],
    ["bg_reconcile", { isReadOnly: false }, "ask"],
  ];

  it("matches recorded pre-change decisions exactly", async () => {
    const hm = new HookManager(toolDefs(), guard());
    hm.setWorkspaceDir(process.cwd());
    for (const [tool, extra, decision] of expected) {
      const result = await hm.runPreHook(ctx(tool, extra));
      assert.equal(result.decision, decision, `${tool} expected ${decision}, got ${result.decision}`);
    }
  });

  it("mcp tools without a definition default to non-readonly context", async () => {
    // buildHookContext 的兜底：未在 toolDefs 中的 mcp__* 工具不得被当作只读。
    const { ToolPipeline } = await import("../../dist/pipeline/hooks.js");
    const hm = new HookManager(toolDefs(), guard());
    hm.setPlanMode(true);
    const pipeline = new ToolPipeline(toolDefs(), hm);
    const built = pipeline.buildHookContext(
      { id: "1", name: "mcp__unknown__write", arguments: {} },
      undefined
    );
    assert.equal(built.isReadOnly, false);
    const decision = await hm.runPreHook(built);
    assert.equal(decision.decision, "deny");
  });
});
