import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { daemonAuthHeaders } from "../../dist/daemon-security.js";

const ENTRY = path.join(process.cwd(), "dist/index.js");
const DAEMON_ENTRY = path.join(process.cwd(), "dist/daemon.js");

async function getFreePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise((resolve) => server.close(() => resolve(undefined)));
  return port;
}

async function waitForHealth(baseUrl, timeoutMs = 10_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("daemon health check timed out");
}

function waitForExit(child, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("attach process did not exit in time"));
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

test("mission attach smoke: follows logs until mission reaches terminal state", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-attach-"));
  const daemonPort = await getFreePort();
  const llmPort = await getFreePort();
  const baseUrl = `http://127.0.0.1:${daemonPort}`;

  const llmServer = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/chat/completions") {
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          id: "cmpl-attach",
          object: "chat.completion",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "attach-ok", tool_calls: [] },
              finish_reason: "stop",
            },
          ],
        }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve, reject) => {
    llmServer.once("error", reject);
    llmServer.listen(llmPort, "127.0.0.1", resolve);
  });

  const daemon = spawn(process.execPath, [DAEMON_ENTRY], {
    env: {
      ...process.env,
      OPENAI_API_KEY: "test-key",
      QLING_LLM_API_KEY: "test-key",
      QLING_LLM_PROVIDER: "openai",
      QLING_LLM_ENDPOINT: `http://127.0.0.1:${llmPort}`,
      QLING_LLM_MODEL: "gpt-test",
      QLING_DAEMON_PORT: String(daemonPort),
      QLING_FILE_STATE_DIR: stateDir,
      QLING_MEMORY_WAL_ENABLED: "false",
      QLING_METRICS_ENABLED: "false",
      QLING_FEATURES_DYNAMIC_DISCOVERY: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForHealth(baseUrl);
    const authHeaders = daemonAuthHeaders(stateDir);

    const create = await fetch(`${baseUrl}/missions`, {
      method: "POST",
      headers: { ...authHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Attach Mission",
        description: "follow this mission",
        sessionId: "session-attach",
      }),
    });
    assert.equal(create.status, 200);
    const payload = await create.json();
    assert.ok(payload.missionId);

    const attach = spawn(process.execPath, [ENTRY, "mission", "attach", payload.missionId], {
      env: {
        ...process.env,
        QLING_DAEMON_PORT: String(daemonPort),
        QLING_FILE_STATE_DIR: stateDir,
        OPENAI_API_KEY: "",
        DEEPSEEK_API_KEY: "",
        QLING_LLM_API_KEY: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    attach.stdout.on("data", (chunk) => { stdout += String(chunk); });
    attach.stderr.on("data", (chunk) => { stderr += String(chunk); });

    const { code, signal } = await waitForExit(attach);
    assert.equal(signal, null, stderr);
    assert.equal(code, 0, stderr);
    assert.match(stdout, /只读跟随/);
    assert.match(stdout, /使命执行成功/);
  } finally {
    daemon.kill("SIGTERM");
    await new Promise((resolve) => daemon.once("exit", () => resolve(undefined)));
    await new Promise((resolve) => llmServer.close(() => resolve(undefined)));
    spawnSync(process.execPath, [ENTRY, "daemon", "stop"], {
      env: {
        ...process.env,
        QLING_DAEMON_PORT: String(daemonPort),
        QLING_FILE_STATE_DIR: stateDir,
      },
      encoding: "utf-8",
    });
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});
