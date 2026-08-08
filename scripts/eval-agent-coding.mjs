#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAgentEvalOutput } from "../dist/eval/agent-output.js";

const enabled = /^(1|true|on|yes)$/i.test(String(process.env.QLING_EVAL_LLM ?? ""));
const apiKey = process.env.QLING_LLM_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
if (!enabled || !apiKey) {
  console.log(JSON.stringify({ eval: "agent-coding", status: "skip", reason: enabled ? "missing API key" : "QLING_EVAL_LLM is not enabled" }));
  process.exit(0);
}

const root = await mkdtemp(join(tmpdir(), "qling-real-coding-eval-"));
const workspace = join(root, "workspace");
const home = join(root, "home");
await mkdir(workspace, { recursive: true });
await mkdir(home, { recursive: true });
await writeFile(join(workspace, "math.mjs"), "export function add(a, b) { return a + b; }\n", "utf8");
await writeFile(
  join(workspace, "math.test.mjs"),
  "import assert from 'node:assert/strict';\nimport { add } from './math.mjs';\nassert.equal(add(2, 2), 5);\n",
  "utf8",
);

const started = Date.now();
try {
  const entry = join(process.cwd(), "dist", "index.js");
  const child = spawn(process.execPath, [
    entry,
    "run",
    "--json",
    "隔离编码评测：读取 math.mjs 和 math.test.mjs，修复测试中错误的期望值。只能使用 read 与 patch/write 文件工具，不得使用 bash，不得创建新文件。完成后只输出 JSON：{\"changed\":\"math.test.mjs\"}。",
  ], {
    cwd: workspace,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      QLING_FILE_STATE_DIR: join(root, "state"),
      QLING_FILE_CACHE_DIR: join(root, "cache"),
      QLING_METRICS_DIR: join(root, "metrics"),
      QLING_WORKSPACE_DIR: workspace,
      QLING_BOOT_QUIET: "true",
      QLING_DASHBOARD_ENABLED: "false",
      QLING_METRICS_OTEL_ENABLED: "false",
      QLING_GUARD_PERMISSIONS_DEFAULT: "allow",
      QLING_SANDBOX_PROFILE: "workspace",
      QLING_TOOL_ALLOWLIST: "read,search,patch,write",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  const exitCode = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("real coding Agent evaluation timed out after 180s"));
    }, 180_000);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  assert.equal(exitCode, 0, stderr.slice(-2000));
  const parsed = parseAgentEvalOutput(stdout);
  const testFile = await readFile(join(workspace, "math.test.mjs"), "utf8");
  const sourceFile = await readFile(join(workspace, "math.mjs"), "utf8");
  const files = (await readdir(workspace)).sort();
  assert.equal(parsed.ok, true);
  assert.ok(parsed.tools.includes("read"), "Agent must inspect the fixture before editing");
  assert.ok(parsed.tools.some((tool) => tool === "patch" || tool === "write"), "Agent must use a scoped file mutation tool");
  assert.ok(parsed.tools.every((tool) => ["read", "patch", "write"].includes(tool)), `Unexpected tool path: ${parsed.tools.join(",")}`);
  assert.match(testFile, /add\(2, 2\), 4/);
  assert.doesNotMatch(testFile, /add\(2, 2\), 5/);
  assert.equal(sourceFile, "export function add(a, b) { return a + b; }\n");
  assert.deepEqual(files, ["math.mjs", "math.test.mjs"]);
  console.log(JSON.stringify({
    eval: "agent-coding",
    status: "pass",
    durationMs: Date.now() - started,
    tools: parsed.tools,
    toolCalls: parsed.toolCalls,
    toolFailures: parsed.toolFailures,
    recovered: parsed.toolFailures > 0,
    usage: parsed.usage,
    evidence: {
      executor: "agent",
      model: "real",
      verifier: "environment",
      claim: "A real Qling AgentLoop repaired an isolated repository fixture with scoped file tools; intermediate failures are recorded separately from the final verdict.",
      limitations: ["Single small edit task; not representative of repository-scale coding."],
    },
  }));
} finally {
  await rm(root, { recursive: true, force: true });
}
