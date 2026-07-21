import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  daemonAuthHeaders,
  getOrCreateDaemonToken,
  resolveDaemonBinding,
} from "../../dist/daemon-security.js";

test("daemon binding defaults to authenticated loopback", () => {
  assert.deepEqual(resolveDaemonBinding({}), { host: "127.0.0.1", authEnabled: true });
  assert.throws(
    () => resolveDaemonBinding({ QLING_DAEMON_HOST: "0.0.0.0" }),
    /ALLOW_REMOTE/
  );
  assert.throws(
    () => resolveDaemonBinding({
      QLING_DAEMON_HOST: "0.0.0.0",
      QLING_DAEMON_ALLOW_REMOTE: "1",
      QLING_DAEMON_AUTH: "off",
    }),
    /authentication/
  );
  assert.deepEqual(
    resolveDaemonBinding({ QLING_DAEMON_HOST: "127.0.0.1", QLING_DAEMON_AUTH: "off" }),
    { host: "127.0.0.1", authEnabled: false }
  );
});

test("daemon bearer token is 256-bit, stable, and readable by local clients", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-daemon-token-"));
  try {
    const first = await getOrCreateDaemonToken(dir);
    const second = await getOrCreateDaemonToken(dir);
    assert.equal(first, second);
    assert.match(first, /^[a-f0-9]{64}$/);
    assert.equal(daemonAuthHeaders(dir).Authorization, `Bearer ${first}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
