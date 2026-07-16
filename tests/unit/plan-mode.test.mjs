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
  hm.setWorkspaceDir(process.cwd());
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
    arguments: { path: "src/foo.ts" },
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

  // G3.1：计划目录 write 允许
  const planWrite = await hm.runPreHook({
    toolName: "write",
    arguments: { path: ".qling/plans/demo.md", content: "# plan" },
    isReadOnly: false,
    isDestructive: false,
  });
  assert.equal(planWrite.decision, "allow");

  hm.setPlanMode(false);
  const writeAgain = await hm.runPreHook({
    toolName: "write",
    arguments: { path: "a.ts", content: "x" },
    isReadOnly: false,
    isDestructive: false,
  });
  assert.equal(writeAgain.decision, "allow");
});

test("/plan approve exits plan mode and queues implement prompt", async () => {
  let plan = true;
  const lines = [];
  const prompts = [];
  await planCommand.execute(["approve"], {
    writeLine: (s) => lines.push(String(s)),
    writeError: (s) => lines.push(String(s)),
    setImmediatePrompt: (p) => prompts.push(p),
    workspaceDir: process.cwd(),
    agentLoop: {
      isPlanMode: () => plan,
      setPlanMode: (v) => {
        plan = Boolean(v);
      },
      getWorkspaceDir: () => process.cwd(),
    },
  });
  assert.equal(plan, false);
  assert.match(lines.join("\n"), /Mode:\s*normal/i);
  assert.equal(prompts.length, 1);
});

test("/plan on and off toggle AgentLoop plan mode", async () => {
  let plan = false;
  const lines = [];
  const chrome = [];
  const prompts = [];
  const context = {
    writeLine: (s) => lines.push(String(s)),
    writeError: (s) => lines.push(String(s)),
    setImmediatePrompt: (p) => prompts.push(p),
    applySessionChrome: (p) => chrome.push(p),
    agentLoop: {
      isPlanMode: () => plan,
      setPlanMode: (v) => {
        plan = Boolean(v);
      },
      getPermissionMode: () => "ask",
    },
  };

  await planCommand.execute(["on"], context);
  assert.equal(plan, true);
  // TUI 路径：只改 chrome，不写提示行
  assert.equal(lines.filter(Boolean).length, 0);
  assert.deepEqual(chrome.at(-1), { sessionMode: "plan", permissionMode: "ask" });

  await planCommand.execute(["off"], context);
  assert.equal(plan, false);
  assert.deepEqual(chrome.at(-1), { sessionMode: "agent", permissionMode: "ask" });

  lines.length = 0;
  await planCommand.execute(["fix the flaky test"], context);
  assert.equal(plan, true);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /fix the flaky test/);
  assert.deepEqual(chrome.at(-1), { sessionMode: "plan", permissionMode: "ask" });
});

test("/plan status reports mode", async () => {
  const chrome = [];
  await planCommand.execute(["status"], {
    writeLine: () => {},
    writeError: () => {},
    applySessionChrome: (p) => chrome.push(p),
    agentLoop: {
      isPlanMode: () => true,
      setPlanMode: () => {},
      getPermissionMode: () => "ask",
    },
  });
  assert.deepEqual(chrome.at(-1), { sessionMode: "plan", permissionMode: "ask" });
});

test("/mode cycle is Grok order: normal → plan → auto → normal", async () => {
  let plan = false;
  let permission = "ask";
  const chrome = [];
  const lines = [];
  const context = {
    writeLine: (line) => lines.push(String(line)),
    writeError: (line) => lines.push(String(line)),
    applySessionChrome: (p) => chrome.push(p),
    agentLoop: {
      isPlanMode: () => plan,
      setPlanMode: (enabled) => { plan = Boolean(enabled); },
      getPermissionMode: () => permission,
      setPermissionMode: (mode) => { permission = mode; },
    },
  };

  // normal → plan
  await modeCommand.execute(["cycle"], context);
  assert.deepEqual({ plan, permission }, { plan: true, permission: "ask" });
  assert.deepEqual(chrome.at(-1), { sessionMode: "plan", permissionMode: "ask" });

  // plan → auto (always-approve)
  await modeCommand.execute(["cycle"], context);
  assert.deepEqual({ plan, permission }, { plan: false, permission: "allow" });
  assert.deepEqual(chrome.at(-1), { sessionMode: "agent", permissionMode: "allow" });

  // auto → normal
  await modeCommand.execute(["cycle"], context);
  assert.deepEqual({ plan, permission }, { plan: false, permission: "ask" });
  assert.equal(lines.filter(Boolean).length, 0);
  assert.deepEqual(chrome.at(-1), { sessionMode: "agent", permissionMode: "ask" });
});

test("/mode plan|auto|normal sets directly", async () => {
  let plan = false;
  let permission = "ask";
  const chrome = [];
  const context = {
    writeLine: () => {},
    writeError: () => {},
    applySessionChrome: (p) => chrome.push(p),
    agentLoop: {
      isPlanMode: () => plan,
      setPlanMode: (enabled) => { plan = Boolean(enabled); },
      getPermissionMode: () => permission,
      setPermissionMode: (mode) => { permission = mode; },
    },
  };

  await modeCommand.execute(["auto"], context);
  assert.deepEqual({ plan, permission }, { plan: false, permission: "allow" });
  assert.deepEqual(chrome.at(-1), { sessionMode: "agent", permissionMode: "allow" });

  await modeCommand.execute(["plan"], context);
  assert.deepEqual({ plan, permission }, { plan: true, permission: "ask" });

  await modeCommand.execute(["normal"], context);
  assert.deepEqual({ plan, permission }, { plan: false, permission: "ask" });
});

test("/mode cycle from deny (treated as normal) goes to plan", async () => {
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
