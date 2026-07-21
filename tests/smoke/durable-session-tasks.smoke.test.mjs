import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";

import { SessionRegistry } from "../../dist/session/session-registry.js";
import { daemonAuthHeaders } from "../../dist/daemon-security.js";

const DAEMON_ENTRY = path.join(process.cwd(), "dist/daemon.js");

async function waitFor(predicate, timeoutMs, errorMessage) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(errorMessage);
}

async function getFreePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test("durable session tasks smoke: daemon executes durable loop and durable goal from session snapshot", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-durable-session-"));
  const daemonPort = await getFreePort();
  const baseUrl = `http://127.0.0.1:${daemonPort}`;
  const sessionId = "session-durable-smoke";

  const llmServer = createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/chat/completions") {
      res.writeHead(404);
      res.end();
      return;
    }

    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const payload = JSON.parse(body);
      const message = payload.messages?.[payload.messages.length - 1]?.content ?? "";

      let content = "ok";
      if (message.includes("你是轻灵的 Goal Evaluator")) {
        content = "{\"done\":true,\"reason\":\"看到通过证据\"}";
      } else if (message.includes("当前激活目标条件") || message.includes("目标条件：")) {
        content = "build passed evidence";
      } else if (message.includes("检查构建结果")) {
        content = "loop turn finished";
      }

      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: "cmpl-durable-smoke",
        object: "chat.completion",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content },
            finish_reason: "stop",
          },
        ],
      }));
    });
  });
  await new Promise((resolve, reject) => {
    llmServer.once("error", reject);
    llmServer.listen(0, "127.0.0.1", resolve);
  });
  const llmAddress = llmServer.address();
  const llmEndpoint = `http://127.0.0.1:${llmAddress.port}`;

  const registry = new SessionRegistry({ stateDir });
  await registry.save({
    name: sessionId,
    sessionId,
    workspaceDir: process.cwd(),
    createdAt: "2026-05-17T00:00:00.000Z",
    updatedAt: "2026-05-17T00:00:00.000Z",
    messages: [{ role: "user", content: "initial context" }],
    turnCount: 1,
    sessionTokens: 100,
    compactionCount: 0,
  });

  const daemon = spawn(process.execPath, [DAEMON_ENTRY], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      OPENAI_API_KEY: "test-key",
      QLING_LLM_API_KEY: "test-key",
      QLING_LLM_PROVIDER: "openai",
      QLING_LLM_ENDPOINT: llmEndpoint,
      QLING_FILE_STATE_DIR: stateDir,
      QLING_DAEMON_PORT: String(daemonPort),
      QLING_RUNTIME_MAX_STEPS: "2",
    },
    stdio: "ignore",
  });

  try {
    await waitFor(async () => {
      const resp = await fetch(`${baseUrl}/health`).catch(() => null);
      return resp?.ok ? true : false;
    }, 10_000, "daemon health check timed out");
    const authHeaders = daemonAuthHeaders(stateDir);

    let response = await fetch(`${baseUrl}/sessions/${sessionId}/loop-tasks`, {
      method: "POST",
      headers: { ...authHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "检查构建结果",
        intervalMs: 1_000,
        mode: "fixed",
      }),
    });
    assert.equal(response.status, 200);

    const loopSnapshot = await waitFor(async () => {
      const restored = await registry.load(sessionId);
      return restored?.turnCount > 1 ? restored : null;
    }, 10_000, "durable loop did not advance session snapshot");
    assert.ok(loopSnapshot.turnCount > 1);

    response = await fetch(`${baseUrl}/sessions/${sessionId}/goal`, {
      method: "POST",
      headers: { ...authHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        condition: "所有测试通过",
      }),
    });
    assert.equal(response.status, 200);

    const goalPayload = await waitFor(async () => {
      const resp = await fetch(`${baseUrl}/sessions/${sessionId}/goal`, { headers: authHeaders }).catch(() => null);
      if (!resp?.ok) return null;
      const data = await resp.json();
      return data?.status === "achieved" ? data : null;
    }, 10_000, "durable goal did not reach achieved");
    assert.equal(goalPayload.runner, "daemon");
    assert.equal(goalPayload.status, "achieved");
  } finally {
    daemon.kill("SIGTERM");
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        daemon.kill("SIGKILL");
        resolve(undefined);
      }, 2_000);
      daemon.once("exit", () => {
        clearTimeout(timer);
        resolve(undefined);
      });
    });
    await new Promise((resolve) => llmServer.close(() => resolve(undefined)));
  }
});
