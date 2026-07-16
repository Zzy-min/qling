import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { join } from "node:path";

const ENTRY = join(process.cwd(), "dist/index.js");

function waitForExit(child, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("child process did not exit in time"));
    }, timeoutMs);

    child.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

test("cli run smoke: one-shot mode exits cleanly after response", async () => {
  let requestCount = 0;
  const server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/chat/completions") {
      requestCount++;
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "cmpl-test",
            object: "chat.completion",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: "run-ok",
                  tool_calls: [],
                },
                finish_reason: "stop",
              },
            ],
          })
        );
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const endpoint = `http://127.0.0.1:${address.port}`;

  const child = spawn(
    process.execPath,
    [
      ENTRY,
      "run",
      "smoke-task",
      "--endpoint",
      endpoint,
      "--api-key",
      "test-key",
      "--provider",
      "openai",
      "--model",
      "gpt-test",
    ],
    {
      env: {
        ...process.env,
        QLING_MEMORY_WAL_ENABLED: "true",
        QLING_MEMORY_PROJECTION_INTERVAL_MS: "30",
        QLING_METRICS_ENABLED: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  try {
    const { code, signal } = await waitForExit(child);
    assert.equal(signal, null, `unexpected signal: ${signal ?? "none"}; stderr=${stderr}`);
    assert.equal(code, 0, `unexpected exit code: ${code}; stderr=${stderr}`);
    assert.match(stdout, /run-ok/);
    assert.ok(requestCount >= 1, "expected at least one /chat/completions call");
  } finally {
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  }
});

test("cli run smoke: --json emits parseable evidence events and final result", async () => {
  const server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/chat/completions") {
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "cmpl-json-test",
            object: "chat.completion",
            usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "json-run-ok", tool_calls: [] },
                finish_reason: "stop",
              },
            ],
          })
        );
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const child = spawn(
    process.execPath,
    [
      ENTRY,
      "run",
      "json-smoke-task",
      "--json",
      "--endpoint",
      `http://127.0.0.1:${address.port}`,
      "--api-key",
      "test-key",
      "--provider",
      "openai",
      "--model",
      "gpt-test",
    ],
    {
      env: {
        ...process.env,
        QLING_MEMORY_WAL_ENABLED: "true",
        QLING_MEMORY_PROJECTION_INTERVAL_MS: "30",
        QLING_METRICS_ENABLED: "false",
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
    assert.equal(signal, null, `unexpected signal: ${signal ?? "none"}; stderr=${stderr}`);
    assert.equal(code, 0, `unexpected exit code: ${code}; stderr=${stderr}`);

    const events = stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.ok(events.some((event) => event.type === "run_started"));
    assert.ok(events.some((event) => event.type === "run_completed" && event.status === "succeeded"));
    const result = events.at(-1);
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.type, "result");
    assert.equal(result.ok, true);
    assert.equal(result.result, "json-run-ok");
    assert.equal(result.usage.totalTokens, 6);
    assert.equal(result.usage.source, "provider");
  } finally {
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  }
});

test("cli run smoke: --json auto-denies console approval without corrupting stdout", async () => {
  let requestCount = 0;
  const server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/chat/completions") {
      requestCount++;
      req.resume();
      req.on("end", () => {
        const message = requestCount === 1
          ? {
              role: "assistant",
              content: "",
              tool_calls: [{
                id: "tc-headless-read",
                type: "function",
                function: { name: "read", arguments: JSON.stringify({ path: "package.json" }) },
              }],
            }
          : { role: "assistant", content: "approval-handled", tool_calls: [] };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          id: `cmpl-approval-${requestCount}`,
          object: "chat.completion",
          choices: [{ index: 0, message, finish_reason: "stop" }],
        }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const child = spawn(
    process.execPath,
    [
      ENTRY,
      "run",
      "read package.json",
      "--json",
      "--endpoint",
      `http://127.0.0.1:${address.port}`,
      "--api-key",
      "test-key",
      "--provider",
      "openai",
      "--model",
      "gpt-test",
    ],
    {
      env: {
        ...process.env,
        QLING_MEMORY_WAL_ENABLED: "false",
        QLING_METRICS_ENABLED: "false",
        QLING_FEATURES_DASHBOARD: "false",
        QLING_GUARD_PERMISSIONS_DEFAULT: "ask",
        QLING_PERMISSIONS_MODE: "ask",
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
    assert.equal(signal, null, `unexpected signal: ${signal ?? "none"}; stderr=${stderr}`);
    assert.equal(code, 0, `unexpected exit code: ${code}; stderr=${stderr}`);
    assert.doesNotMatch(stdout, /Approval Required|Allow\?/);

    const events = stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.ok(events.some((event) => event.type === "tool_completed" && event.status === "failed"));
    assert.equal(events.at(-1).type, "result");
    assert.equal(events.at(-1).result, "approval-handled");
  } finally {
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  }
});
