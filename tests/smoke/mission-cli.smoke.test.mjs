import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";

import { MissionManager } from "../../dist/mission/manager.js";

const DAEMON_ENTRY = path.join(process.cwd(), "dist/daemon.js");

function getJson(response) {
  return response.json();
}

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
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("daemon health check timed out");
}

async function waitForMissionStatus(baseUrl, missionId, expected, timeoutMs = 10_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const response = await fetch(`${baseUrl}/missions/${missionId}`);
    if (response.ok) {
      const mission = await response.json();
      if (mission.status === expected) {
        return mission;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`mission ${missionId} did not reach status ${expected}`);
}

async function waitForMissionLog(baseUrl, missionId, regex, timeoutMs = 5_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const response = await fetch(`${baseUrl}/missions/${missionId}/logs`);
    if (response.ok) {
      const logs = await response.json();
      if (logs.some((event) => event.type === "log" && regex.test(event.data.message))) {
        return logs;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`mission ${missionId} log did not match regex ${regex}`);
}


test("mission daemon smoke: detail, logs, control endpoints and retry work end to end", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-daemon-"));
  const daemonPort = await getFreePort();
  const llmPort = await getFreePort();
  const baseUrl = `http://127.0.0.1:${daemonPort}`;

  const llmServer = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/chat/completions") {
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          id: "cmpl-mission",
          object: "chat.completion",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "mission-ok",
                tool_calls: [],
              },
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

  const seedManager = new MissionManager(stateDir);
  await seedManager.init();
  const seeded = await seedManager.createMission("Seeded Mission", "seed-only", "session-seeded");

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

  let daemonStdout = "";
  let daemonStderr = "";
  daemon.stdout.on("data", (chunk) => {
    daemonStdout += String(chunk);
  });
  daemon.stderr.on("data", (chunk) => {
    daemonStderr += String(chunk);
  });

  try {
    await waitForHealth(baseUrl);

    let response = await fetch(`${baseUrl}/missions/${seeded.id}/pause`, { method: "POST" });
    assert.equal(response.status, 200);
    let payload = await getJson(response);
    assert.equal(payload.ok, true);

    response = await fetch(`${baseUrl}/missions/${seeded.id}`);
    assert.equal(response.status, 200);
    let mission = await getJson(response);
    assert.equal(mission.status, "paused");

    response = await fetch(`${baseUrl}/missions/${seeded.id}/resume`, { method: "POST" });
    assert.equal(response.status, 200);
    response = await fetch(`${baseUrl}/missions/${seeded.id}`);
    mission = await getJson(response);
    assert.equal(mission.status, "queued");

    response = await fetch(`${baseUrl}/missions/${seeded.id}/cancel`, { method: "POST" });
    assert.equal(response.status, 200);
    response = await fetch(`${baseUrl}/missions/${seeded.id}/logs`);
    const seededLogs = await getJson(response);
    assert.equal(Array.isArray(seededLogs), true);
    assert.equal(seededLogs.some((event) => event.type === "control" && event.data.action === "cancel"), true);

    response = await fetch(`${baseUrl}/missions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "HTTP Mission",
        description: "run via daemon",
        sessionId: "session-http",
      }),
    });
    assert.equal(response.status, 200);
    payload = await getJson(response);
    assert.equal(payload.ok, true);
    assert.ok(payload.missionId);

    const completed = await waitForMissionStatus(baseUrl, payload.missionId, "succeeded");
    assert.equal(completed.status, "succeeded");

    const logs = await waitForMissionLog(baseUrl, payload.missionId, /执行成功|success/i);
    assert.ok(logs);

    response = await fetch(`${baseUrl}/missions/${payload.missionId}/retry`, { method: "POST" });
    assert.equal(response.status, 200);
    payload = await getJson(response);
    assert.equal(payload.ok, true);
    assert.ok(payload.missionId);
    assert.notEqual(payload.missionId, completed.id);

    const retried = await waitForMissionStatus(baseUrl, payload.missionId, "succeeded");
    assert.equal(retried.status, "succeeded");
  } finally {
    daemon.kill("SIGTERM");
    await new Promise((resolve) => daemon.once("exit", () => resolve(undefined)));
    await new Promise((resolve) => llmServer.close(() => resolve(undefined)));
    await fs.rm(stateDir, { recursive: true, force: true });
  }

  assert.equal(daemon.exitCode === 0 || daemon.exitCode === null, true, `unexpected daemon exit, stdout=${daemonStdout}, stderr=${daemonStderr}`);
});
