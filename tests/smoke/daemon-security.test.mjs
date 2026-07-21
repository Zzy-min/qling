import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { DaemonSessionApi } from "../../dist/session/daemon-session-api.js";

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForHealth(url, child) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`daemon exited early: ${child.exitCode}`);
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("daemon health timeout");
}

test("daemon keeps health anonymous but protects state routes and caps request bodies", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "qling-daemon-security-"));
  const port = await freePort();
  const child = spawn(process.execPath, [join(process.cwd(), "dist", "daemon.js")], {
    cwd: process.cwd(),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      QLING_FILE_STATE_DIR: stateDir,
      QLING_DAEMON_PORT: String(port),
      QLING_DAEMON_HOST: "127.0.0.1",
      QLING_MEMORY_WAL_ENABLED: "false",
      QLING_METRICS_ENABLED: "false",
    },
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    await waitForHealth(base, child);
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/missions`)).status, 401);

    const token = (await readFile(join(stateDir, "daemon.token"), "utf8")).trim();
    assert.match(token, /^[a-f0-9]{64}$/);
    const authorized = await fetch(`${base}/missions`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(authorized.status, 200);

    const previousStateDir = process.env.QLING_FILE_STATE_DIR;
    process.env.QLING_FILE_STATE_DIR = stateDir;
    try {
      const api = new DaemonSessionApi(base);
      assert.deepEqual(await api.listLoopTasks("auth-smoke"), []);
    } finally {
      if (previousStateDir === undefined) delete process.env.QLING_FILE_STATE_DIR;
      else process.env.QLING_FILE_STATE_DIR = previousStateDir;
    }

    const invalid = await fetch(`${base}/missions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: "{not-json",
    });
    assert.equal(invalid.status, 400);

    const oversized = await fetch(`${base}/missions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: `{"x":"${"a".repeat(1024 * 1024 + 1)}`,
    });
    assert.equal(oversized.status, 413);
  } finally {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
    await rm(stateDir, { recursive: true, force: true });
  }
});
