#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { runSubtask } from "../dist/tools/subtask.js";
import { summarizeMultiWriteEvaluation } from "./lib/multi-write-evidence.mjs";

const execFileAsync = promisify(execFile);
const enabled = /^(1|true|on|yes)$/i.test(String(process.env.QLING_EVAL_LLM ?? ""));
const apiKey = process.env.QLING_LLM_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
if (!enabled || !apiKey) {
  console.log(JSON.stringify({ eval: "agent-multi-write", status: "skip", reason: enabled ? "missing API key" : "QLING_EVAL_LLM is not enabled" }));
  process.exit(0);
}

const root = await mkdtemp(join(tmpdir(), "qling-multi-write-"));
const workspace = join(root, "repo");
const state = join(root, "state");
await mkdir(join(workspace, "src"), { recursive: true });
await mkdir(join(workspace, "test"), { recursive: true });
await writeFile(join(workspace, "src", "math.js"), "export function add(a, b) { return a - b; }\n", "utf8");
await writeFile(join(workspace, "src", "text.js"), "export function slug(value) { return value; }\n", "utf8");
await writeFile(join(workspace, "test", "behavior.test.mjs"), [
  'import test from "node:test";',
  'import assert from "node:assert/strict";',
  'import { add } from "../src/math.js";',
  'import { slug } from "../src/text.js";',
  'test("add", () => assert.equal(add(2, 3), 5));',
  'test("slug", () => assert.equal(slug("Hello World"), "hello-world"));',
  "",
].join("\n"), "utf8");
await writeFile(join(workspace, "package.json"), '{"type":"module","scripts":{"test":"node --test"}}\n', "utf8");
await execFileAsync("git", ["init", "-q"], { cwd: workspace });
await execFileAsync("git", ["config", "user.email", "eval@example.invalid"], { cwd: workspace });
await execFileAsync("git", ["config", "user.name", "Qling Eval"], { cwd: workspace });
await execFileAsync("git", ["add", "."], { cwd: workspace });
await execFileAsync("git", ["commit", "-qm", "fixture"], { cwd: workspace });

const previousEnv = Object.fromEntries([
  "QLING_FEATURES_CONTROLLED_SUBAGENTS",
  "QLING_SUBTASK_AUTO_INTEGRATE",
  "QLING_WORKSPACE_DIR",
  "QLING_FILE_STATE_DIR",
  "QLING_FILE_CACHE_DIR",
  "QLING_METRICS_DIR",
  "QLING_GUARD_PERMISSIONS_DEFAULT",
  "QLING_SANDBOX_PROFILE",
].map((key) => [key, process.env[key]]));
Object.assign(process.env, {
  QLING_FEATURES_CONTROLLED_SUBAGENTS: "true",
  QLING_SUBTASK_AUTO_INTEGRATE: "true",
  QLING_WORKSPACE_DIR: workspace,
  QLING_FILE_STATE_DIR: state,
  QLING_FILE_CACHE_DIR: join(root, "cache"),
  QLING_METRICS_DIR: join(root, "metrics"),
  QLING_GUARD_PERMISSIONS_DEFAULT: "allow",
  QLING_SANDBOX_PROFILE: "workspace",
});

const started = Date.now();
try {
  const [math, text] = await Promise.all([
    runSubtask({
      task: "读取 test/behavior.test.mjs 与 src/math.js，只修复 src/math.js 中 add 的实现，使相关测试期望成立。不得修改其他文件。",
      context: "这是隔离评测仓库；做最小修改并报告证据。",
      role: "implement",
      owned_paths: ["src/math.js"],
      max_iterations: 8,
      timeout_ms: 180_000,
    }),
    runSubtask({
      task: "读取 test/behavior.test.mjs 与 src/text.js，只修复 src/text.js 中 slug 的实现：小写并将空格替换为连字符。不得修改其他文件。",
      context: "这是隔离评测仓库；做最小修改并报告证据。",
      role: "implement",
      owned_paths: ["src/text.js"],
      max_iterations: 8,
      timeout_ms: 180_000,
    }),
  ]);
  let verifier;
  try {
    const result = await execFileAsync(process.execPath, ["--test"], { cwd: workspace, timeout: 30_000 });
    verifier = { ok: true, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    verifier = {
      ok: false,
      stdout: typeof error?.stdout === "string" ? error.stdout : "",
      stderr: typeof error?.stderr === "string" ? error.stderr : "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const mathSource = await readFile(join(workspace, "src", "math.js"), "utf8");
  const textSource = await readFile(join(workspace, "src", "text.js"), "utf8");
  const changed = (await execFileAsync("git", ["diff", "--name-only", "HEAD"], { cwd: workspace })).stdout.trim().split(/\r?\n/).filter(Boolean).sort();
  const summary = summarizeMultiWriteEvaluation({
    durationMs: Date.now() - started,
    agentResults: [math, text],
    changed,
    mathSource,
    textSource,
    verifier,
  });
  console.log(JSON.stringify(summary));
  if (summary.status !== "pass") process.exitCode = 1;
} finally {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(root, { recursive: true, force: true });
}
