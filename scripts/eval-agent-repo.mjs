#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAgentEvalOutput } from "../dist/eval/agent-output.js";

const enabled = /^(1|true|on|yes)$/i.test(String(process.env.QLING_EVAL_LLM ?? ""));
const apiKey = process.env.QLING_LLM_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
if (!enabled || !apiKey) {
  console.log(JSON.stringify({ eval: "agent-repo", status: "skip", reason: enabled ? "missing API key" : "QLING_EVAL_LLM is not enabled" }));
  process.exit(0);
}

const root = await mkdtemp(join(tmpdir(), "qling-real-repo-eval-"));
const workspace = join(root, "workspace");
const home = join(root, "home");
await mkdir(join(workspace, "src"), { recursive: true });
await mkdir(join(workspace, "test"), { recursive: true });
await mkdir(home, { recursive: true });
const testSource = [
  "import test from 'node:test';",
  "import assert from 'node:assert/strict';",
  "import { welcome } from '../src/greeting.mjs';",
  "test('welcome formats a friendly greeting', () => assert.equal(welcome('Qling'), 'hello Qling'));",
  "",
].join("\n");
await writeFile(join(workspace, "package.json"), JSON.stringify({ name: "agent-repo-fixture", type: "module", scripts: { test: "node --test" } }, null, 2) + "\n", "utf8");
await writeFile(join(workspace, "src", "greeting.mjs"), "export function greet(name) { return 'hi ' + name; }\n", "utf8");
await writeFile(join(workspace, "src", "app.mjs"), "import { greet } from './greeting.mjs';\nexport const message = greet('Qling');\n", "utf8");
await writeFile(join(workspace, "test", "greeting.test.mjs"), testSource, "utf8");

const started = Date.now();
try {
  const entry = join(process.cwd(), "dist", "index.js");
  const child = spawn(process.execPath, [
    entry,
    "run",
    "--json",
    "隔离仓库评测：测试要求导出 welcome(name) 并返回 `hello ${name}`。把 src/greeting.mjs 的 greet 重构为 welcome，同步修改 src/app.mjs 的导入和调用。不得修改 test 或 package.json，不得创建文件。用 read 检查文件，用 patch/write 修改，最后必须用 bash 执行 npm test。完成后只输出 JSON：{\"changed\":[\"src/greeting.mjs\",\"src/app.mjs\"],\"tests\":\"passed\"}。",
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
      QLING_TOOL_ALLOWLIST: "read,search,patch,write,bash",
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
      reject(new Error("real repository Agent evaluation timed out after 240s"));
    }, 240_000);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  assert.equal(exitCode, 0, stderr.slice(-3000));
  const parsed = parseAgentEvalOutput(stdout);
  const greeting = await readFile(join(workspace, "src", "greeting.mjs"), "utf8");
  const app = await readFile(join(workspace, "src", "app.mjs"), "utf8");
  const testAfter = await readFile(join(workspace, "test", "greeting.test.mjs"), "utf8");
  const packageAfter = JSON.parse(await readFile(join(workspace, "package.json"), "utf8"));
  const independentTest = spawnSync(process.execPath, ["--test"], { cwd: workspace, encoding: "utf8", timeout: 30_000 });
  assert.equal(parsed.ok, true);
  assert.ok(parsed.tools.includes("read"), "Agent must inspect the repository through read");
  assert.ok(parsed.tools.includes("bash"), "Agent must execute the declared test command");
  assert.ok(parsed.tools.some((tool) => tool === "patch" || tool === "write"), "Agent must use a scoped file mutation tool");
  assert.ok(parsed.tools.every((tool) => ["read", "search", "patch", "write", "bash"].includes(tool)), `Unexpected tool path: ${parsed.tools.join(",")}`);
  assert.match(greeting, /export function welcome\(name\)/);
  assert.doesNotMatch(greeting, /\bgreet\b/);
  assert.match(app, /import \{ welcome \}/);
  assert.match(app, /welcome\('Qling'\)/);
  assert.doesNotMatch(app, /\bgreet\b/);
  assert.equal(testAfter, testSource, "Agent must not modify the test oracle");
  assert.equal(packageAfter.scripts.test, "node --test");
  assert.deepEqual((await readdir(workspace)).sort(), ["package.json", "src", "test"]);
  assert.deepEqual((await readdir(join(workspace, "src"))).sort(), ["app.mjs", "greeting.mjs"]);
  assert.deepEqual(await readdir(join(workspace, "test")), ["greeting.test.mjs"]);
  assert.equal(independentTest.status, 0, independentTest.stdout + independentTest.stderr);
  console.log(JSON.stringify({
    eval: "agent-repo",
    status: "pass",
    durationMs: Date.now() - started,
    tools: parsed.tools,
    toolCalls: parsed.toolCalls,
    toolFailures: parsed.toolFailures,
    recovered: parsed.toolFailures > 0,
    independentVerifier: "node --test",
    usage: parsed.usage,
    evidence: {
      executor: "agent",
      model: "real",
      verifier: "environment",
      claim: "A real Qling AgentLoop completed a multi-file refactor, ran tests, and passed an independent verifier without modifying the oracle.",
      limitations: ["Small synthetic repository; not a SWE-bench-scale task."],
    },
  }));
} finally {
  await rm(root, { recursive: true, force: true });
}
