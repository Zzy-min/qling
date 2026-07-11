import test from "node:test";
import assert from "node:assert/strict";

import { HookManager, PLAN_MODE_DENY_TOOLS } from "../../dist/pipeline/hooks.js";
import { planCommand } from "../../dist/commands/claude-style.js";
import { modeCommand } from "../../dist/commands/mode.js";

function createHookManager(defaultDecision = "allow") {
  return new HookManager(
    [
      { name: "read", description: "r", parameters: { type: "object", properties: {} } },
      { name: "write", description: "w", parameters: { type: "object", properties: {} } },
      { name: "patch", description: "p", parameters: { type: "object", properties: {} } },
      { name: "bash", description: "b", parameters: { type: "object", properties: {} } },
      { name: "search", description: "s", parameters: { type: "object", properties: {} } },
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

test("PLAN_MODE_DENY_TOOLS covers write-side tools", () => {
  assert.ok(PLAN_MODE_DENY_TOOLS.includes("write"));
  assert.ok(PLAN_MODE_DENY_TOOLS.includes("patch"));
  assert.ok(PLAN_MODE_DENY_TOOLS.includes("bash"));
});

test("plan mode denies write/patch/bash but allows read", async () => {
  const hm = createHookManager("allow");
  assert.equal(hm.isPlanMode(), false);

  hm.setPlanMode(true);
  assert.equal(hm.isPlanMode(), true);

  const write = await hm.runPreHook({
    toolName: "write",
    arguments: { path: "a.ts", content: "x" },
    isReadOnly: false,
    isDestructive: false,
  });
  assert.equal(write.decision, "deny");
  assert.match(String(write.blockingError), /Plan Mode/i);

  const patch = await hm.runPreHook({
    toolName: "patch",
    arguments: {},
    isReadOnly: false,
    isDestructive: false,
  });
  assert.equal(patch.decision, "deny");

  const bash = await hm.runPreHook({
    toolName: "bash",
    arguments: { command: "echo hi" },
    isReadOnly: false,
    isDestructive: false,
  });
  assert.equal(bash.decision, "deny");

  const read = await hm.runPreHook({
    toolName: "read",
    arguments: { path: "a.ts" },
    isReadOnly: true,
    isDestructive: false,
  });
  assert.equal(read.decision, "allow");

  hm.setPlanMode(false);
  const writeAgain = await hm.runPreHook({
    toolName: "write",
    arguments: { path: "a.ts", content: "x" },
    isReadOnly: false,
    isDestructive: false,
  });
  assert.equal(writeAgain.decision, "allow");
});

test("/plan on and off toggle AgentLoop plan mode", async () => {
  let plan = false;
  const lines = [];
  const prompts = [];
  const context = {
    writeLine: (s) => lines.push(String(s)),
    writeError: (s) => lines.push(String(s)),
    setImmediatePrompt: (p) => prompts.push(p),
    agentLoop: {
      isPlanMode: () => plan,
      setPlanMode: (v) => {
        plan = Boolean(v);
      },
    },
  };

  await planCommand.execute(["on"], context);
  assert.equal(plan, true);
  assert.match(lines.join("\n"), /plan/i);

  await planCommand.execute(["off"], context);
  assert.equal(plan, false);

  lines.length = 0;
  await planCommand.execute(["fix the flaky test"], context);
  assert.equal(plan, true);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /Plan Mode/);
  assert.match(prompts[0], /fix the flaky test/);
});

test("/plan status reports mode", async () => {
  const lines = [];
  await planCommand.execute(["status"], {
    writeLine: (s) => lines.push(String(s)),
    writeError: (s) => lines.push(String(s)),
    agentLoop: {
      isPlanMode: () => true,
      setPlanMode: () => {},
    },
  });
  assert.match(lines.join("\n"), /plan/);
});

test("/mode cycle rotates agent ask, plan ask, and agent allow", async () => {
  let plan = false;
  let permission = "ask";
  const lines = [];
  const context = {
    writeLine: (line) => lines.push(String(line)),
    writeError: (line) => lines.push(String(line)),
    agentLoop: {
      isPlanMode: () => plan,
      setPlanMode: (enabled) => { plan = Boolean(enabled); },
      getPermissionMode: () => permission,
      setPermissionMode: (mode) => { permission = mode; },
    },
  };

  await modeCommand.execute(["cycle"], context);
  assert.deepEqual({ plan, permission }, { plan: true, permission: "ask" });

  await modeCommand.execute(["cycle"], context);
  assert.deepEqual({ plan, permission }, { plan: false, permission: "allow" });

  await modeCommand.execute(["cycle"], context);
  assert.deepEqual({ plan, permission }, { plan: false, permission: "ask" });
  assert.match(lines.join("\n"), /Always Agree/);
});

test("/mode cycle normalizes deny mode into plan ask", async () => {
  let plan = false;
  let permission = "deny";
  const context = {
    writeLine: () => {},
    writeError: () => {},
    agentLoop: {
      isPlanMode: () => plan,
      setPlanMode: (enabled) => { plan = Boolean(enabled); },
      getPermissionMode: () => permission,
      setPermissionMode: (mode) => { permission = mode; },
    },
  };

  await modeCommand.execute(["cycle"], context);

  assert.deepEqual({ plan, permission }, { plan: true, permission: "ask" });
});
