#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAgentEvalOutput } from "../dist/eval/agent-output.js";

const enabled = /^(1|true|on|yes)$/i.test(String(process.env.QLING_EVAL_LLM ?? ""));
const apiKey = process.env.QLING_LLM_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
if (!enabled || !apiKey) {
  console.log(JSON.stringify({
    eval: "agent",
    status: "skip",
    reason: enabled ? "missing API key" : "QLING_EVAL_LLM is not enabled",
  }));
  process.exit(0);
}

const root = await mkdtemp(join(tmpdir(), "qling-real-agent-eval-"));
const expected = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const started = Date.now();
try {
  const child = spawn(process.execPath, [
    "dist/index.js",
    "run",
    "--json",
    "只读评测：必须使用 read 工具读取当前工作区 package.json，不要使用 bash，不要修改文件。最终只输出 JSON 对象，字段 name、version、testScript，分别取 package.json 的 name、version、scripts.test。",
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: root,
      USERPROFILE: root,
      QLING_FILE_STATE_DIR: join(root, ".qling"),
      QLING_FILE_CACHE_DIR: join(root, ".qling", "cache"),
      QLING_METRICS_DIR: join(root, ".qling", "metrics"),
      QLING_WORKSPACE_DIR: process.cwd(),
      QLING_BOOT_QUIET: "true",
      QLING_DASHBOARD_ENABLED: "false",
      QLING_METRICS_OTEL_ENABLED: "false",
      QLING_TOOL_ALLOWLIST: "read",
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
      reject(new Error("real Agent evaluation timed out after 120s"));
    }, 120_000);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  assert.equal(exitCode, 0, stderr.slice(-2000));
  const parsed = parseAgentEvalOutput(stdout);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.tools, ["read"], "Agent must satisfy the read-only task through the read tool");
  assert.equal(parsed.toolFailures, 0, "Agent must not rely on failed tool attempts");
  assert.deepEqual(parsed.answer, {
    name: expected.name,
    version: expected.version,
    testScript: expected.scripts.test,
  });
  console.log(JSON.stringify({
    eval: "agent",
    status: "pass",
    durationMs: Date.now() - started,
    toolCalls: parsed.toolCalls,
    toolFailures: parsed.toolFailures,
    tools: parsed.tools,
    usage: parsed.usage,
    evidence: {
      executor: "agent",
      model: "real",
      verifier: "environment",
      claim: "A real Qling AgentLoop read the repository and produced an externally verified answer.",
      limitations: ["Single read-only task; not a coding benchmark or pass@k result."],
    },
  }));
} finally {
  await rm(root, { recursive: true, force: true });
}
