// ============================================================
// 05 子 agent 初始化隔离
//
// 断言方向已翻转为「已隔离」：
//   explorer 工具 ⊆ 角色白名单（无 mcp__* / use_tool）
//   MCP spawn/connect 只有父进程 1 次
//   子 agent 无 SessionStart，父 JsonHookRunner 发 SubagentStart/Stop
// 假 MCP / hook 都在临时目录里用 node 起，不联网。
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AgentLoop } from "../../dist/agent-loop.js";
import { SubtaskRunner } from "../../dist/agent/subtask.js";
import {
  ROLE_DEFINITIONS,
  SUBAGENT_ROLES,
  filterToolsByAllowlist,
  filterToolsForRole,
} from "../../dist/agents/roles.js";
import { MCPRegistry } from "../../dist/mcp/registry.js";

const ENV_KEYS = [
  "QLING_MCP_SERVERS",
  "QLING_MCP_TOOL_EXPOSURE",
  "QLING_MCP_CONNECTION_TIMEOUT_MS",
  "QLING_MCP_CALL_TIMEOUT_MS",
  "QLING_JSON_HOOKS_ENABLED",
  "QLING_JSON_HOOKS_MANIFEST",
  "QLING_JSON_HOOKS_TIMEOUT_MS",
  "QLING_MEMORY_WAL_ENABLED",
  "QLING_METRICS_ENABLED",
  "QLING_FEATURES_DASHBOARD",
  "QLING_FEATURES_DYNAMIC_DISCOVERY",
  "QLING_FEATURES_SEMANTIC_MEMORY",
  "QLING_RUNTIME_MODE",
  "QLING_EXPERIMENTAL_ANCHORED_EDIT",
  "QLING_METRICS_OTEL_ENABLED",
];

function snapshotEnv() {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(previous) {
  for (const key of ENV_KEYS) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
}

function tool(name) {
  return {
    name,
    description: name,
    parameters: { type: "object", properties: {} },
  };
}

const MCP_SERVER_SOURCE = `
const fs = require("node:fs");
const readline = require("node:readline");

const spawnLog = process.env.QLING_TEST_MCP_SPAWN_LOG;
if (spawnLog) {
  fs.appendFileSync(
    spawnLog,
    JSON.stringify({ pid: process.pid, at: Date.now() }) + "\\n"
  );
}

function reply(msg) {
  fs.writeSync(1, JSON.stringify(msg) + "\\n");
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const trimmed = String(line || "").trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (msg.id === undefined || msg.id === null) return;
  if (msg.method === "initialize") {
    reply({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "leak", version: "0.0.0" },
      },
    });
    return;
  }
  if (msg.method === "tools/list") {
    reply({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        tools: [
          {
            name: "leak_ping",
            description: "05 repro tool that explorer must not receive",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      },
    });
    return;
  }
  reply({ jsonrpc: "2.0", id: msg.id, result: {} });
});
`;

const HOOK_SOURCE = `
const fs = require("node:fs");
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
});
process.stdin.on("end", () => {
  const log = process.env.QLING_TEST_HOOK_LOG;
  if (log) fs.appendFileSync(log, buf.trim() + "\\n");
  process.exit(0);
});
`;

function readLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

test("05 isolation: explorer subagent keeps the role allowlist and does not reconnect MCP", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "qling-05-subagent-"));
  const stateDir = join(root, "state");
  const mcpScript = join(root, "mcp-server.cjs");
  const hookScript = join(root, "session-start-hook.cjs");
  const spawnLog = join(root, "mcp-spawns.jsonl");
  const hookLog = join(root, "session-start.jsonl");
  const manifestPath = join(root, "hooks.json");
  const previousEnv = snapshotEnv();
  const originalWait = AgentLoop.prototype.waitForInit;
  const originalRun = AgentLoop.prototype.run;
  const originalConnectAll = MCPRegistry.prototype.connectAll;
  const seen = [];
  const noted = new WeakSet();
  const toolsAtInit = new Map();
  let mcpConnectAllCount = 0;
  let parent = null;

  AgentLoop.prototype.waitForInit = async function waitForInitAndNote() {
    await originalWait.call(this);
    if (!noted.has(this)) {
      noted.add(this);
      seen.push(this);
      toolsAtInit.set(this, this.getTools().map((item) => item.name));
    }
  };
  // SubtaskRunner.run() 在 waitForInit 之后会进入 LLM。复现只关心 init
  // 完成后的工具表，不能打到真实模型。
  AgentLoop.prototype.run = async function stubRunAfterInit() {
    return "05-repro-no-llm";
  };
  MCPRegistry.prototype.connectAll = async function countConnectAll(...args) {
    mcpConnectAllCount += 1;
    return originalConnectAll.apply(this, args);
  };

  try {
    await writeFile(mcpScript, MCP_SERVER_SOURCE, "utf8");
    await writeFile(hookScript, HOOK_SOURCE, "utf8");
    await writeFile(
      manifestPath,
      JSON.stringify({
        version: 1,
        events: {
          SessionStart: [{ command: process.execPath, args: [hookScript] }],
          SubagentStart: [{ command: process.execPath, args: [hookScript] }],
          SubagentStop: [{ command: process.execPath, args: [hookScript] }],
        },
      }),
      "utf8"
    );

    process.env.QLING_MEMORY_WAL_ENABLED = "false";
    process.env.QLING_METRICS_ENABLED = "false";
    process.env.QLING_FEATURES_DASHBOARD = "false";
    process.env.QLING_FEATURES_DYNAMIC_DISCOVERY = "false";
    process.env.QLING_FEATURES_SEMANTIC_MEMORY = "false";
    process.env.QLING_RUNTIME_MODE = "legacy";
    process.env.QLING_METRICS_OTEL_ENABLED = "false";
    delete process.env.QLING_EXPERIMENTAL_ANCHORED_EDIT;
    delete process.env.QLING_MCP_TOOL_EXPOSURE;
    process.env.QLING_JSON_HOOKS_ENABLED = "true";
    process.env.QLING_JSON_HOOKS_MANIFEST = manifestPath;
    process.env.QLING_JSON_HOOKS_TIMEOUT_MS = "4000";
    process.env.QLING_MCP_CONNECTION_TIMEOUT_MS = "8000";
    process.env.QLING_MCP_CALL_TIMEOUT_MS = "8000";
    process.env.QLING_MCP_SERVERS = JSON.stringify({
      leak: {
        name: "leak",
        command: process.execPath,
        args: [mcpScript],
        enabled: true,
        env: { QLING_TEST_MCP_SPAWN_LOG: spawnLog },
      },
    });
    process.env.QLING_TEST_HOOK_LOG = hookLog;

    const baseTools = [tool("read"), tool("search"), tool("subtask")];
    const parentConfig = {
      apiKey: "test-key",
      provider: "openai",
      endpoint: "http://127.0.0.1:9",
      model: "test-model",
      maxIterations: 1,
      tools: baseTools,
      runtime: {
        workspaceDir: root,
        fileCacheDir: join(root, "cache"),
        fileStateDir: stateDir,
        maxSteps: 1,
        parseRetries: 0,
        toolRepeatLimit: 2,
        timeoutMs: 5000,
      },
    };

    const allowlistBeforeInit = filterToolsForRole(
      baseTools.filter((item) => item.name !== "subtask"),
      "explore"
    ).map((item) => item.name);

    parent = new AgentLoop(parentConfig);
    await parent.waitForInit();
    const spawnsAfterParent = readLines(await readFile(spawnLog, "utf8").catch(() => ""));

    const parentToolsBefore = parent.getTools().map((item) => item.name);
    const runner = new SubtaskRunner(parentConfig, {
      hookRunner: parent.getJsonHookRunner(),
    });
    const exploreTask = "05 isolation explorer " + "x".repeat(240);
    await runner.run({
      task: exploreTask,
      role: "explore",
      maxIterations: 1,
      timeoutMs: 5000,
    });

    const rolePool = [
      "read",
      "search",
      "code_symbols",
      "lsp",
      "skill",
      "planner",
      "url_fetch",
      "write",
      "patch",
      "bash",
      "todo",
      "subtask",
      "use_tool",
      "search_tool",
      "mcp__leak__leak_ping",
    ].map(tool);
    const roleTools = {};
    for (const role of SUBAGENT_ROLES) {
      const ceiling = filterToolsForRole(rolePool, role).map((item) => item.name);
      await runner.run({
        task: `role ceiling ${role}`,
        role,
        tools: rolePool,
        maxIterations: 1,
        timeoutMs: 5000,
      });
      const roleChild = seen[seen.length - 1];
      roleTools[role] = {
        ceiling,
        actual: roleChild.getTools().map((item) => item.name),
        atInit: toolsAtInit.get(roleChild),
      };
    }

    const child = seen.find((agent) => agent !== parent);
    const childTools = child.getTools().map((item) => item.name);
    const leaked = childTools.filter(
      (name) => name.startsWith("mcp__") || name === "use_tool" || name === "search_tool"
    );
    const spawnLines = readLines(await readFile(spawnLog, "utf8").catch(() => ""));
    const hookPayloads = readLines(await readFile(hookLog, "utf8").catch(() => "")).map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { raw: line };
      }
    });
    const auditPath = join(stateDir, "hooks", "events.jsonl");
    const auditEvents = readLines(await readFile(auditPath, "utf8").catch(() => ""))
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    const childSessionId = child.getSessionId();
    const parentSessionId = parent.getSessionId();
    const childSessionStarts = hookPayloads.filter(
      (payload) => payload.sessionId === childSessionId
    );
    const subagentStarts = hookPayloads.filter((payload) => payload.role && !("success" in payload));
    const subagentStops = hookPayloads.filter((payload) => payload.role && "success" in payload);
    const exploreStart = subagentStarts.find((payload) => payload.task?.startsWith("05 isolation explorer"));
    const exploreStop = subagentStops.find((payload) => payload.task?.startsWith("05 isolation explorer"));

    const observation = {
      allowlistBeforeInit,
      parentTools: parent.getTools().map((item) => item.name),
      childTools,
      leaked,
      roleTools,
      mcpSpawnCount: spawnLines.length,
      mcpSpawnAfterParent: spawnsAfterParent.length,
      mcpConnectAllCount,
      parentSessionId,
      childSessionId,
      childSessionStartCount: childSessionStarts.length,
      subagentStartCount: subagentStarts.length,
      subagentStopCount: subagentStops.length,
      sessionStartAuditCount: auditEvents.filter((event) => event.event === "SessionStart").length,
    };
    console.log("05-ISOLATED " + JSON.stringify(observation));
    t.diagnostic("05-ISOLATED " + JSON.stringify(observation));

    assert.deepEqual(
      allowlistBeforeInit.filter((name) => name.startsWith("mcp__") || name === "use_tool"),
      []
    );
    assert.ok(child, "SubtaskRunner did not construct an explorer AgentLoop");
    assert.notEqual(childSessionId, parentSessionId);
    assert.deepEqual(childTools, allowlistBeforeInit);
    assert.deepEqual(leaked, []);
    assert.deepEqual(parent.getTools().map((item) => item.name), parentToolsBefore);
    assert.ok(parentToolsBefore.includes("mcp__leak__leak_ping"));
    assert.ok(parentToolsBefore.includes("read"));
    assert.ok(parentToolsBefore.includes("subtask"));
    for (const role of SUBAGENT_ROLES) {
      assert.deepEqual(roleTools[role].actual, roleTools[role].ceiling, role);
      assert.deepEqual(roleTools[role].atInit, roleTools[role].ceiling, role + " at init");
      assert.ok(!roleTools[role].actual.some((name) => name.startsWith("mcp__") || name === "use_tool" || name === "search_tool"));
      assert.ok(!roleTools[role].actual.includes("subtask"));
    }
    assert.deepEqual(toolsAtInit.get(child), allowlistBeforeInit);
    assert.equal(spawnLines.length, 1, `expected parent-only MCP spawn, got ${spawnLines.length}`);
    assert.equal(mcpConnectAllCount, 1, `expected parent-only connectAll, got ${mcpConnectAllCount}`);
    assert.equal(spawnsAfterParent.length, 1);
    assert.equal(childSessionStarts.length, 0, JSON.stringify(hookPayloads));
    assert.equal(auditEvents.filter((event) => event.event === "SessionStart").length, 1);
    assert.equal(subagentStarts.length, 1 + SUBAGENT_ROLES.length);
    assert.equal(subagentStops.length, 1 + SUBAGENT_ROLES.length);
    assert.equal(auditEvents.filter((event) => event.event === "SubagentStart").length, 1 + SUBAGENT_ROLES.length);
    assert.equal(auditEvents.filter((event) => event.event === "SubagentStop").length, 1 + SUBAGENT_ROLES.length);
    assert.equal(exploreStart.role, "explore");
    assert.equal(exploreStart.task.length, 200);
    assert.equal(exploreTask.startsWith(exploreStart.task), true);
    assert.equal(exploreStop.role, "explore");
    assert.equal(exploreStop.task, exploreStart.task);
    assert.equal(exploreStop.success, true);
    assert.equal(typeof exploreStop.durationMs, "number");
    assert.ok(exploreStop.durationMs >= 0);
  } finally {
    AgentLoop.prototype.waitForInit = originalWait;
    AgentLoop.prototype.run = originalRun;
    MCPRegistry.prototype.connectAll = originalConnectAll;
    delete process.env.QLING_TEST_HOOK_LOG;
    if (parent) {
      try {
        await parent.shutdown();
      } catch {
        // parent shutdown is best-effort; the child is shut down inside SubtaskRunner
      }
    }
    restoreEnv(previousEnv);
    await rm(root, { recursive: true, force: true });
  }
});

test("builtin role allowlists do not include MCP tools; mcp__* is opt-in only", () => {
  assert.deepEqual(ROLE_DEFINITIONS.explore.allowedTools, [
    "read", "search", "code_symbols", "lsp", "skill", "planner", "url_fetch",
  ]);
  assert.deepEqual(ROLE_DEFINITIONS.implement.allowedTools, [
    "read", "search", "code_symbols", "lsp", "write", "patch", "bash", "skill", "todo", "planner", "url_fetch",
  ]);
  assert.deepEqual(ROLE_DEFINITIONS.review.allowedTools, [
    "read", "search", "code_symbols", "lsp", "skill", "planner",
  ]);
  const pool = [tool("read"), tool("mcp__alpha__leak_alpha"), tool("use_tool"), tool("subtask")];
  assert.deepEqual(filterToolsByAllowlist(pool, ["read"]).map((item) => item.name), ["read"]);
  assert.deepEqual(
    filterToolsByAllowlist(pool, ["read", "mcp__*"]).map((item) => item.name),
    ["read", "mcp__alpha__leak_alpha"]
  );
  for (const role of SUBAGENT_ROLES) {
    const names = filterToolsForRole(pool, role).map((item) => item.name);
    assert.deepEqual(names, ["read"]);
    assert.equal(names.includes("use_tool"), false);
    assert.equal(names.some((name) => name.startsWith("mcp__")), false);
  }
});

test("05 isolation: subagent still runs PreToolUse and a deny blocks the tool", async () => {
  const root = await mkdtemp(join(tmpdir(), "qling-05-deny-"));
  const stateDir = join(root, "state");
  const mcpScript = join(root, "mcp-server.cjs");
  const logScript = join(root, "session-start-hook.cjs");
  const denyScript = join(root, "pretool-deny.cjs");
  const spawnLog = join(root, "mcp-spawns.jsonl");
  const hookLog = join(root, "hooks.jsonl");
  const manifestPath = join(root, "hooks.json");
  const previousEnv = snapshotEnv();
  const extraKeys = [
    "QLING_GUARD_PERMISSIONS_DEFAULT",
    "QLING_PERMISSIONS_MODE",
    "QLING_GUARD_PERMISSIONS_RULES",
    "QLING_GUARD_RATE_LIMIT_ENABLED",
  ];
  const extraEnv = Object.fromEntries(extraKeys.map((key) => [key, process.env[key]]));
  let agent = null;
  const denySource = [
    'const fs = require("node:fs");',
    'let buf = "";',
    'process.stdin.setEncoding("utf8");',
    'process.stdin.on("data", (chunk) => { buf += chunk; });',
    'process.stdin.on("end", () => {',
    '  const log = process.env.QLING_TEST_HOOK_LOG;',
    '  if (log) fs.appendFileSync(log, buf.trim() + "\\n");',
    '  process.stdout.write(JSON.stringify({ decision: "deny", blockingError: "05-subagent-deny" }));',
    '  process.exit(0);',
    '});',
    '',
  ].join("\n");

  try {
    await writeFile(join(root, "secret.txt"), "SHOULD_NOT_LEAK_FILE_BODY", "utf8");
    await writeFile(mcpScript, MCP_SERVER_SOURCE, "utf8");
    await writeFile(logScript, HOOK_SOURCE, "utf8");
    await writeFile(denyScript, denySource, "utf8");
    await writeFile(manifestPath, JSON.stringify({
      version: 1,
      events: {
        SessionStart: [{ command: process.execPath, args: [logScript] }],
        PreToolUse: [{ command: process.execPath, args: [denyScript] }],
      },
    }), "utf8");

    process.env.QLING_MEMORY_WAL_ENABLED = "false";
    process.env.QLING_METRICS_ENABLED = "false";
    process.env.QLING_FEATURES_DASHBOARD = "false";
    process.env.QLING_FEATURES_DYNAMIC_DISCOVERY = "false";
    process.env.QLING_FEATURES_SEMANTIC_MEMORY = "false";
    process.env.QLING_RUNTIME_MODE = "legacy";
    process.env.QLING_METRICS_OTEL_ENABLED = "false";
    delete process.env.QLING_EXPERIMENTAL_ANCHORED_EDIT;
    delete process.env.QLING_MCP_TOOL_EXPOSURE;
    process.env.QLING_JSON_HOOKS_ENABLED = "true";
    process.env.QLING_JSON_HOOKS_MANIFEST = manifestPath;
    process.env.QLING_JSON_HOOKS_TIMEOUT_MS = "4000";
    process.env.QLING_MCP_CONNECTION_TIMEOUT_MS = "8000";
    process.env.QLING_TEST_HOOK_LOG = hookLog;
    process.env.QLING_GUARD_PERMISSIONS_DEFAULT = "allow";
    process.env.QLING_PERMISSIONS_MODE = "allow";
    process.env.QLING_GUARD_PERMISSIONS_RULES = "[]";
    process.env.QLING_GUARD_RATE_LIMIT_ENABLED = "false";
    process.env.QLING_MCP_SERVERS = JSON.stringify({
      leak: {
        name: "leak",
        command: process.execPath,
        args: [mcpScript],
        enabled: true,
        env: { QLING_TEST_MCP_SPAWN_LOG: spawnLog },
      },
    });

    agent = new AgentLoop({
      apiKey: "test-key",
      provider: "openai",
      endpoint: "http://127.0.0.1:9",
      model: "test-model",
      maxIterations: 2,
      tools: [tool("read")],
      subagent: { parentSessionId: "parent-deny", role: "explore" },
      runtime: {
        workspaceDir: root,
        fileCacheDir: join(root, "cache"),
        fileStateDir: stateDir,
        maxSteps: 2,
        parseRetries: 0,
        toolRepeatLimit: 2,
        timeoutMs: 5000,
      },
    });
    await agent.waitForInit();
    assert.deepEqual(agent.getTools().map((item) => item.name), ["read"]);
    assert.equal(readLines(await readFile(spawnLog, "utf8").catch(() => "")).length, 0);

    agent.checkAutoDream = async () => {};
    let calls = 0;
    agent.chat = async () => {
      calls += 1;
      if (calls === 1) {
        return {
          content: "",
          tool_calls: [{
            id: "call-read-1",
            type: "function",
            function: {
              name: "read",
              arguments: JSON.stringify({ path: join(root, "secret.txt") }),
            },
          }],
        };
      }
      return { content: "done", tool_calls: [] };
    };
    agent.addUserMessage("read the secret");
    assert.equal(await agent.run(), "done");

    const messages = agent.getMessagesSnapshot().map((message) => String(message.content ?? "")).join("\n");
    const audit = await readFile(join(stateDir, "hooks", "events.jsonl"), "utf8");
    const hookLines = readLines(await readFile(hookLog, "utf8"));
    assert.match(messages, /05-subagent-deny/);
    assert.equal(messages.includes("SHOULD_NOT_LEAK_FILE_BODY"), false);
    assert.match(audit, /PreToolUse/);
    assert.equal(audit.includes("SessionStart"), false);
    assert.equal(hookLines.length, 1);
    assert.match(hookLines[0], /"toolName":"read"/);
  } finally {
    if (agent) {
      try { await agent.shutdown(); } catch { /* best-effort */ }
    }
    restoreEnv(previousEnv);
    for (const key of extraKeys) {
      if (extraEnv[key] === undefined) delete process.env[key];
      else process.env[key] = extraEnv[key];
    }
    delete process.env.QLING_TEST_HOOK_LOG;
    await rm(root, { recursive: true, force: true });
  }
});
