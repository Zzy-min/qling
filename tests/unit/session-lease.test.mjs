import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  SessionLease,
  SessionLeaseConflictError,
  isSessionLeaseTokenActive,
} from "../../dist/runtime/session-lease.js";

test("session lease enforces one cross-process writer and uses a fencing token", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-session-lease-"));
  try {
    const first = SessionLease.acquire({ stateDir, sessionId: "session-a", workspaceDir: stateDir });
    assert.equal(isSessionLeaseTokenActive(stateDir, "session-a", first.token), true);
    assert.throws(
      () => SessionLease.acquire({ stateDir, sessionId: "session-a", workspaceDir: stateDir }),
      SessionLeaseConflictError,
    );
    const other = SessionLease.acquire({ stateDir, sessionId: "session-b", workspaceDir: stateDir });
    other.release();
    first.release();
    const successor = SessionLease.acquire({ stateDir, sessionId: "session-a", workspaceDir: stateDir });
    assert.notEqual(successor.token, first.token);
    successor.release();
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test("corrupt lease fails closed instead of being stolen", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-session-corrupt-"));
  try {
    const crypto = await import("node:crypto");
    const key = crypto.createHash("sha256").update("session-a").digest("hex");
    const lockDir = path.join(stateDir, "session-leases", `${key}.lock`);
    await fs.mkdir(lockDir, { recursive: true });
    await fs.writeFile(path.join(lockDir, "owner.json"), "{broken");
    assert.throws(
      () => SessionLease.acquire({ stateDir, sessionId: "session-a", workspaceDir: stateDir }),
      /租约记录损坏/,
    );
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});
