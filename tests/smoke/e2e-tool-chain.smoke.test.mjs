// ============================================================
// E2E: 多轮工具调用链（CLI spawn + fake LLM server）
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { createFakeLLM } from "../helpers/fake-llm-server.mjs";

const ENTRY = join(process.cwd(), "dist/index.js");

function waitForExit(child, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("child process did not exit in time"));
    }, timeoutMs);

    child.once("error", (err) => { clearTimeout(timer); reject(err); });
    child.once("exit", (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
}

test("e2e: tool call chain with fake LLM server", async () => {
  // Respond from request semantics instead of a brittle verifier request index.
  const FILLER = { content: "PASS ok", tool_calls: [] };
  const fake = createFakeLLM((request, index) => {
    if (index === 0) return {
      content: "",
      tool_calls: [{
        id: "tc-read-1",
        type: "function",
        function: {
          name: "read",
          arguments: JSON.stringify({ path: "package.json" }),
        },
      }],
    };
    if (request.messages?.some((message) => message.role === "tool")) return {
      content: "I have read the package.json file successfully.",
      tool_calls: [],
    };
    return FILLER;
  });

  await fake.ready();
  const endpoint = fake.endpoint;

  const child = spawn(
    process.execPath,
    [
      ENTRY,
      "run",
      "read package.json and summarize",
      "--endpoint", endpoint,
      "--api-key", "test-key",
      "--provider", "openai",
      "--model", "gpt-test",
    ],
    {
      env: {
        ...process.env,
        QLING_MEMORY_WAL_ENABLED: "false",
        QLING_METRICS_ENABLED: "false",
        QLING_FEATURES_DASHBOARD: "false",
        QLING_GUARD_ENABLED: "false",
        QLING_GUARD_PERMISSIONS_DEFAULT: "allow",
        QLING_PERMISSIONS_MODE: "allow",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });

  try {
    const { code, signal } = await waitForExit(child);
    assert.equal(signal, null, `unexpected signal: ${signal}; stderr=${stderr.slice(0, 500)}`);
    assert.equal(code, 0, `unexpected exit code: ${code}; stderr=${stderr.slice(0, 500)}`);
    assert.match(stdout, /I have read the package\.json file successfully/);

    const log = fake.getRequestLog();
    assert.ok(log.length >= 2, `expected at least 2 requests, got ${log.length}`);

    // Verify the tool chain: stderr should show tool execution
    assert.match(stderr, /执行.*个工具/, "should show tool execution");
    assert.match(stderr, /✅.*read/, "should show successful read tool");
  } finally {
    await fake.close();
  }
});
