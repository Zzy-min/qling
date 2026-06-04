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
