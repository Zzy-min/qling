#!/usr/bin/env node
/**
 * 05 子 agent 隔离度量。直接 node 运行，只依赖 dist，不联网。
 *
 * 场景：2 个本地 stdio MCP server + 1 次 explorer subtask 初始化路径
 * （父 AgentLoop init，再 SubtaskRunner.run；LLM 被 stub）。
 *
 * stdout 只有一行 JSON：
 * {
 *   subtaskInitMs,          // 子 AgentLoop.waitForInit 耗时
 *   mcpSpawnCount,          // 父 init + 这次 subtask 的 MCP 进程 spawn 总数
 *   childToolsLeaked,       // 子 agent 工具里的 mcp__* / use_tool
 *   childSessionStartCount  // 子 session 的 SessionStart 次数
 * }
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AgentLoop } from "../dist/agent-loop.js";
import { SubtaskRunner } from "../dist/agent/subtask.js";

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
  "QLING_TEST_HOOK_LOG",
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

function readLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

const MCP_SERVER_SOURCE = `
const fs = require("node:fs");
const readline = require("node:readline");
const spawnLog = process.env.QLING_TEST_MCP_SPAWN_LOG;
if (spawnLog) {
  fs.appendFileSync(spawnLog, JSON.stringify({
    pid: process.pid,
    server: process.env.QLING_TEST_MCP_SERVER_NAME || "",
    at: Date.now(),
  }) + "\\n");
}
function reply(msg) {
  fs.writeSync(1, JSON.stringify(msg) + "\\n");
}
const toolName = process.env.QLING_TEST_MCP_TOOL_NAME || "leak_ping";
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const trimmed = String(line || "").trim();
  if (!trimmed) return;
  let msg;
  try { msg = JSON.parse(trimmed); } catch { return; }
  if (msg.id === undefined || msg.id === null) return;
  if (msg.method === "initialize") {
    reply({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: process.env.QLING_TEST_MCP_SERVER_NAME || "leak", version: "0.0.0" },
      },
    });
    return;
  }
  if (msg.method === "tools/list") {
    reply({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        tools: [{
          name: toolName,
          description: "05 eval tool",
          inputSchema: { type: "object", properties: {} },
        }],
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
process.stdin.on("data", (chunk) => { buf += chunk; });
process.stdin.on("end", () => {
  const log = process.env.QLING_TEST_HOOK_LOG;
  if (log) fs.appendFileSync(log, buf.trim() + "\\n");
  process.exit(0);
});
`;

async function main() {
  const root = await mkdtemp(join(tmpdir(), "qling-05-eval-"));
  const stateDir = join(root, "state");
  const mcpScript = join(root, "mcp-server.cjs");
  const hookScript = join(root, "session-start-hook.cjs");
  const spawnLog = join(root, "mcp-spawns.jsonl");
  const hookLog = join(root, "session-start.jsonl");
  const manifestPath = join(root, "hooks.json");
  const previousEnv = snapshotEnv();
  const originalWait = AgentLoop.prototype.waitForInit;
  const originalRun = AgentLoop.prototype.run;
  const initTimings = [];
  let parent = null;

  AgentLoop.prototype.waitForInit = async function timedWaitForInit() {
    const started = Date.now();
    try {
      return await originalWait.call(this);
    } finally {
      initTimings.push({ agent: this, ms: Date.now() - started });
    }
  };
  AgentLoop.prototype.run = async function stubRunAfterInit() {
    return "05-eval-no-llm";
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
    process.env.QLING_TEST_HOOK_LOG = hookLog;
    process.env.QLING_MCP_SERVERS = JSON.stringify({
      alpha: {
        name: "alpha",
        command: process.execPath,
        args: [mcpScript],
        enabled: true,
        env: {
          QLING_TEST_MCP_SPAWN_LOG: spawnLog,
          QLING_TEST_MCP_SERVER_NAME: "alpha",
          QLING_TEST_MCP_TOOL_NAME: "leak_alpha",
        },
      },
      beta: {
        name: "beta",
        command: process.execPath,
        args: [mcpScript],
        enabled: true,
        env: {
          QLING_TEST_MCP_SPAWN_LOG: spawnLog,
          QLING_TEST_MCP_SERVER_NAME: "beta",
          QLING_TEST_MCP_TOOL_NAME: "leak_beta",
        },
      },
    });

    const parentConfig = {
      apiKey: "test-key",
      provider: "openai",
      endpoint: "http://127.0.0.1:9",
      model: "test-model",
      maxIterations: 1,
      tools: [tool("read"), tool("search"), tool("subtask")],
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

    parent = new AgentLoop(parentConfig);
    await parent.waitForInit();

    const runner = new SubtaskRunner(parentConfig);
    await runner.run({
      task: "05 eval: explorer subtask init",
      role: "explore",
      maxIterations: 1,
      timeoutMs: 5000,
    });

    const childTiming = initTimings[1];
    const child = childTiming?.agent;
    const childTools = (child?.config?.tools ?? []).map((item) => item.name);
    const childToolsLeaked = childTools.filter(
      (name) => name.startsWith("mcp__") || name === "use_tool"
    );
    const spawnLines = readLines(await readFile(spawnLog, "utf8").catch(() => ""));
    const hookPayloads = readLines(await readFile(hookLog, "utf8").catch(() => "")).flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
    const childSessionId = child?.getSessionId?.() ?? null;
    const childSessionStartCount = hookPayloads.filter(
      (payload) => payload.sessionId && payload.sessionId === childSessionId
    ).length;

    const report = {
      subtaskInitMs: childTiming?.ms ?? null,
      mcpSpawnCount: spawnLines.length,
      childToolsLeaked,
      childSessionStartCount,
    };
    process.stdout.write(JSON.stringify(report) + "\n");
  } finally {
    AgentLoop.prototype.waitForInit = originalWait;
    AgentLoop.prototype.run = originalRun;
    if (parent) {
      try {
        await parent.shutdown();
      } catch {
        // measurement cleanup only
      }
    }
    restoreEnv(previousEnv);
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
