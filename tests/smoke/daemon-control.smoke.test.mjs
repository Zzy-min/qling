import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const ENTRY = path.join(process.cwd(), "dist/index.js");

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

async function waitForHealth(baseUrl, expectedUp, timeoutMs = 10_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (expectedUp && response.ok) return;
      if (!expectedUp) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }
    } catch {
      if (!expectedUp) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`health check did not reach expected state: ${expectedUp ? "up" : "down"}`);
}

test("daemon control smoke: start, status, stop manage detached daemon", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qingling-daemonctl-"));
  const daemonPort = await getFreePort();
  const baseUrl = `http://127.0.0.1:${daemonPort}`;
  const pidFile = path.join(stateDir, "daemon.pid");

  const env = {
    ...process.env,
    QINGLING_FILE_STATE_DIR: stateDir,
    QINGLING_DAEMON_PORT: String(daemonPort),
    QINGLING_FEATURES_DYNAMIC_DISCOVERY: "false",
    QINGLING_MEMORY_WAL_ENABLED: "false",
    QINGLING_METRICS_ENABLED: "false",
  };

  try {
    let result = spawnSync(process.execPath, [ENTRY, "daemon", "start"], {
      env,
      encoding: "utf-8",
    });
    assert.equal(result.status, 0, result.stderr);
    await waitForHealth(baseUrl, true);

    const pidRaw = await fs.readFile(pidFile, "utf-8");
    assert.match(pidRaw, /^\d+\s*$/);

    result = spawnSync(process.execPath, [ENTRY, "daemon", "status"], {
      env,
      encoding: "utf-8",
    });
    assert.equal(result.status, 0, result.stderr);
    const status = JSON.parse(result.stdout);
    assert.equal(status.running, true);
    assert.equal(status.healthy, true);
    assert.equal(status.managed, true);
    assert.equal(status.port, daemonPort);

    result = spawnSync(process.execPath, [ENTRY, "daemon", "stop"], {
      env,
      encoding: "utf-8",
    });
    assert.equal(result.status, 0, result.stderr);
    await waitForHealth(baseUrl, false);
    await assert.rejects(() => fs.readFile(pidFile, "utf-8"));
  } finally {
    try {
      const result = spawnSync(process.execPath, [ENTRY, "daemon", "stop"], {
        env,
        encoding: "utf-8",
      });
      void result;
    } catch {
      // best effort cleanup
    }
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});
