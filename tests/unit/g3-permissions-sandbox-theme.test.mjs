import test from "node:test";
import assert from "node:assert/strict";
import {
  PermissionGrantStore,
  getPermissionGrantStore,
  resetPermissionGrantStoreForTests,
  formatPermissionPipelineLines,
  PERMISSION_PIPELINE_STAGES,
} from "../../dist/guard/permission-grants.js";
import { HookManager } from "../../dist/pipeline/hooks.js";
import {
  resolveSandboxProfile,
  setSandboxProfile,
  isWriteBlockedByProfile,
  isPathAllowedUnderProfile,
  isBashCwdAllowed,
  formatSandboxStatusLines,
  parseSandboxProfile,
} from "../../dist/runtime/sandbox-profile.js";
import {
  setTheme,
  getActiveThemeId,
  TUI_COLORS,
  parseThemeId,
  reloadThemeFromEnv,
  listThemes,
} from "../../dist/tui/theme.js";
import path from "node:path";

test.afterEach(() => {
  resetPermissionGrantStoreForTests();
  setTheme("bamboo");
  delete process.env.QLING_SANDBOX_PROFILE;
  delete process.env.QLING_WRITE_SANDBOX;
});

function createHookManager(defaultDecision = "ask") {
  return new HookManager(
    [
      { name: "bash", description: "b", parameters: { type: "object", properties: {} } },
      { name: "read", description: "r", parameters: { type: "object", properties: {} } },
    ],
    {
      enabled: true,
      network: { url_fetch: { allowed_url_prefixes: [], deny_private_ips: true, follow_redirects: false } },
      redaction: { enabled: false, patterns: [] },
      audit: { jsonl_path: "" },
      rate_limit: { enabled: false, max_per_minute: 0 },
      content_filter: { enabled: false, pii_detection: false, injection_detection: false, custom_patterns: [] },
      permissions: { default: defaultDecision, rules: [] },
    }
  );
}

test("G3.3 pipeline stages are ordered and documented", () => {
  assert.ok(PERMISSION_PIPELINE_STAGES.length >= 6);
  assert.equal(PERMISSION_PIPELINE_STAGES[0].id, "plan");
  assert.equal(PERMISSION_PIPELINE_STAGES[2].id, "grant");
  const lines = formatPermissionPipelineLines().join("\n");
  assert.match(lines, /Remembered grant|grant/i);
});

test("G3.3 remembered grant skips ask on second evaluate", async () => {
  const hm = createHookManager("ask");
  const first = await hm.runPreHook({
    toolName: "bash",
    arguments: { command: "echo 1" },
    isReadOnly: false,
    isDestructive: false,
  });
  assert.equal(first.decision, "ask");

  getPermissionGrantStore().remember("bash", { reason: "test", arguments: { command: "echo 2" } });
  const second = await hm.runPreHook({
    toolName: "bash",
    arguments: { command: "echo 2" },
    isReadOnly: false,
    isDestructive: false,
  });
  assert.equal(second.decision, "allow");
});

test("G3.4 sandbox profiles", () => {
  assert.equal(parseSandboxProfile("read-only"), "read-only");
  assert.equal(parseSandboxProfile("strict"), "strict");

  setSandboxProfile("read-only");
  assert.equal(resolveSandboxProfile(), "read-only");
  assert.equal(isWriteBlockedByProfile("read-only"), true);

  setSandboxProfile("workspace");
  process.env.QLING_WORKSPACE_DIR = process.cwd();
  const inside = path.join(process.cwd(), "src", "x.ts");
  const outside = path.join(path.parse(process.cwd()).root, "tmp-outside-qling-test");
  assert.equal(isPathAllowedUnderProfile(inside, "workspace"), true);
  assert.equal(isPathAllowedUnderProfile(outside, "workspace"), false);
  assert.equal(isBashCwdAllowed(process.cwd(), "strict"), true);
  assert.equal(isWriteBlockedByProfile("workspace"), false);

  setSandboxProfile("off");
  assert.equal(resolveSandboxProfile(), "off");
  assert.equal(isPathAllowedUnderProfile(outside, "off"), true);
});

test("G3.5 theme packs switch colors", () => {
  assert.equal(listThemes().length, 3);
  assert.equal(parseThemeId("night"), "night");
  setTheme("bamboo");
  const bambooPrimary = TUI_COLORS.primary;
  setTheme("night");
  assert.equal(getActiveThemeId(), "night");
  assert.notEqual(TUI_COLORS.primary, bambooPrimary);
  setTheme("mono");
  assert.equal(getActiveThemeId(), "mono");
  process.env.QLING_TUI_THEME = "night";
  assert.equal(reloadThemeFromEnv(), "night");
  setTheme("bamboo");
});

test("P0-A approved tool call re-enters the full pipeline and runs post hooks", async () => {
  const hm = createHookManager("ask");
  let preRuns = 0;
  let postRuns = 0;
  let failureRuns = 0;
  hm.register("PreToolUse", () => {
    preRuns++;
    return { decision: "allow" };
  });
  hm.register("PostToolUse", () => {
    postRuns++;
  });
  hm.register("PostToolUseFailure", () => {
    failureRuns++;
  });

  const { ToolPipeline } = await import("../../dist/pipeline/hooks.js");
  const { ApprovalRequiredError } = await import("../../dist/guard/approval.js");
  const { fingerprintToolArguments } = await import("../../dist/guard/approval-fingerprint.js");
  const pipeline = new ToolPipeline(
    [{ name: "bash", description: "b", parameters: { type: "object", properties: {} } }],
    hm
  );
  const call = { id: "call-approved-1", name: "bash", arguments: { command: "echo 1" } };

  await assert.rejects(
    () => pipeline.execute(call, async () => ({ tool_call_id: call.id, output: "ok", is_error: false })),
    (error) => error instanceof ApprovalRequiredError
  );
  assert.equal(preRuns, 0, "permission ask returns before custom pre hooks");

  const result = await pipeline.execute(
    call,
    async () => ({ tool_call_id: call.id, output: "ok", is_error: false }),
    { approvedToolCallId: call.id, approvedArgsHash: fingerprintToolArguments(call.arguments) }
  );
  assert.equal(result.is_error, false);
  assert.equal(preRuns, 1, "approved call must run the remaining pre checks");
  assert.equal(postRuns, 1, "approved call must run post hooks");
  assert.equal(failureRuns, 0);
});

test("approval credential is bound to normalized arguments", async () => {
  const hm = createHookManager("ask");
  const { ToolPipeline } = await import("../../dist/pipeline/hooks.js");
  const { ApprovalRequiredError } = await import("../../dist/guard/approval.js");
  const { fingerprintToolArguments } = await import("../../dist/guard/approval-fingerprint.js");
  const pipeline = new ToolPipeline(
    [{ name: "bash", description: "b", parameters: { type: "object", properties: {} } }],
    hm
  );
  const approvedCall = { id: "call-args-1", name: "bash", arguments: { command: "echo approved" } };
  const approvedHash = fingerprintToolArguments(approvedCall.arguments);

  await assert.rejects(
    () => pipeline.execute(
      { ...approvedCall, arguments: { command: "echo swapped" } },
      async () => ({ tool_call_id: approvedCall.id, output: "must not run", is_error: false }),
      { approvedToolCallId: approvedCall.id, approvedArgsHash: approvedHash }
    ),
    (error) => error instanceof ApprovalRequiredError,
    "argument swap must re-enter approval"
  );

  const result = await pipeline.execute(
    approvedCall,
    async () => ({ tool_call_id: approvedCall.id, output: "ok", is_error: false }),
    { approvedToolCallId: approvedCall.id, approvedArgsHash: approvedHash }
  );
  assert.equal(result.is_error, false);
});

test("P0-A approval never bypasses a deny decision", async () => {
  const hm = createHookManager("deny");
  const { ToolPipeline } = await import("../../dist/pipeline/hooks.js");
  const pipeline = new ToolPipeline(
    [{ name: "bash", description: "b", parameters: { type: "object", properties: {} } }],
    hm
  );
  const result = await pipeline.execute(
    { id: "call-denied-1", name: "bash", arguments: { command: "echo 1" } },
    async () => ({ tool_call_id: "call-denied-1", output: "should not run", is_error: false }),
    { approvedToolCallId: "call-denied-1" }
  );
  assert.equal(result.is_error, true);
  assert.doesNotMatch(result.output, /should not run/);
});

test("P0-B remembered grant is bound to its session", () => {
  const store = getPermissionGrantStore();
  store.remember("bash", {
    reason: "session-a",
    sessionId: "session-a",
    arguments: { command: "echo 1" },
  });
  assert.equal(store.hasAllow("bash", { command: "echo 1" }, "session-a"), true);
  assert.equal(store.hasAllow("bash", { command: "echo 1" }, "session-b"), false);
  assert.equal(store.hasAllow("bash", { command: "echo 1" }), false);
  resetPermissionGrantStoreForTests();
});

test("P0-D sandbox reports actual enforcement instead of claiming kernel isolation", async () => {
  const { resolveSandboxEnforcement } = await import("../../dist/runtime/sandbox-profile.js");
  assert.equal(resolveSandboxEnforcement("off").state, "disabled");
  assert.equal(resolveSandboxEnforcement("strict").state, "degraded");
  assert.equal(resolveSandboxEnforcement("read-only").mechanism, "application-path-policy");
  assert.doesNotMatch(formatSandboxStatusLines("strict").join("\n"), /Enforced\s+: enforced/);
  assert.match(formatSandboxStatusLines("strict").join("\n"), /Enforced\s+: degraded/);
});

test("P0-C MCP cancellation is surfaced as TOOL_CANCELED", async () => {
  const { createToolDispatcher } = await import("../../dist/tools/index.js");
  const registry = {
    callTool: async (_server, _tool, _args, signal) => {
      assert.ok(signal instanceof AbortSignal);
      throw new Error("MCP request aborted");
    },
  };
  const controller = new AbortController();
  const dispatcher = createToolDispatcher({
    mcpRegistry: registry,
    signal: () => controller.signal,
  });
  const result = await dispatcher({
    id: "call-mcp-cancel",
    name: "mcp__demo__ping",
    arguments: {},
  });
  assert.equal(result.is_error, true);
  assert.equal(result.error.code, "TOOL_CANCELED");
});

test("P0-B grant scope rejects a different command or target path", () => {
  const store = new PermissionGrantStore();
  store.remember("bash", {
    sessionId: "s1",
    arguments: { command: "echo 1" },
  });
  assert.equal(store.hasAllow("bash", { command: "echo 1" }, "s1"), true);
  assert.equal(store.hasAllow("bash", { command: "echo 2" }, "s1"), false);
  assert.equal(store.hasAllow("bash", { command: "echo 1 && rm -rf /" }, "s1"), false);

  store.remember("read", {
    sessionId: "s1",
    arguments: { path: "a.txt" },
  });
  assert.equal(store.hasAllow("read", { path: "a.txt" }, "s1"), true);
  assert.equal(store.hasAllow("read", { path: "b.txt" }, "s1"), false);
});
