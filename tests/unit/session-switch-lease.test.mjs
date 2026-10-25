import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AgentLoop } from "../../dist/agent-loop.js";
import { SessionLease } from "../../dist/runtime/session-lease.js";

function createAgent(stateDir) {
  return new AgentLoop({
    apiKey: "test-key",
    runtime: {
      workspaceDir: stateDir,
      fileCacheDir: join(stateDir, "cache"),
      fileStateDir: stateDir,
      maxSteps: 1,
      parseRetries: 1,
      toolRepeatLimit: 6,
      timeoutMs: 5_000,
    },
  });
}

test("restore pre-acquires the target session lease and leaves the current session unchanged on conflict", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "qling-session-restore-lease-"));
  const previousReliability = process.env.QLING_FEATURES_RELIABILITY_V2;
  process.env.QLING_FEATURES_RELIABILITY_V2 = "true";
  const agent = createAgent(stateDir);
  let targetLease;
  try {
    await agent.waitForInit();
    agent.messages = [{ role: "user", content: "current session" }];
    await agent.checkpointSession();
    const currentSessionId = agent.getSessionId();
    const currentMessages = agent.getMessagesSnapshot();
    await agent.sessionRegistry.save({
      name: "occupied-target",
      sessionId: "occupied-target",
      workspaceDir: stateDir,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(1).toISOString(),
      messages: [{ role: "user", content: "target session" }],
      turnCount: 1,
      sessionTokens: 0,
      compactionCount: 0,
    });
    targetLease = SessionLease.acquire({ stateDir, sessionId: "occupied-target", workspaceDir: stateDir });

    await assert.rejects(agent.restoreSession("occupied-target"), /已由进程/);
    assert.equal(agent.getSessionId(), currentSessionId);
    assert.deepEqual(agent.getMessagesSnapshot(), currentMessages);
    agent.sessionLease.assertOwned();
  } finally {
    targetLease?.release();
    await agent.shutdown();
    await rm(stateDir, { recursive: true, force: true });
    if (previousReliability === undefined) delete process.env.QLING_FEATURES_RELIABILITY_V2;
    else process.env.QLING_FEATURES_RELIABILITY_V2 = previousReliability;
  }
});

test("fork pre-acquires its new session lease before draining the current session", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "qling-session-fork-lease-"));
  const previousReliability = process.env.QLING_FEATURES_RELIABILITY_V2;
  const originalNow = Date.now;
  process.env.QLING_FEATURES_RELIABILITY_V2 = "true";
  const agent = createAgent(stateDir);
  let targetLease;
  try {
    await agent.waitForInit();
    agent.messages = [{ role: "user", content: "fork source" }];
    await agent.checkpointSession();
    const currentSessionId = agent.getSessionId();
    const currentMessages = agent.getMessagesSnapshot();
    const fixedNow = originalNow() + 60_000;
    targetLease = SessionLease.acquire({ stateDir, sessionId: `session-${fixedNow}`, workspaceDir: stateDir });
    Date.now = () => fixedNow;

    await assert.rejects(agent.forkSession("blocked-fork"), /已由进程/);
    assert.equal(agent.getSessionId(), currentSessionId);
    assert.deepEqual(agent.getMessagesSnapshot(), currentMessages);
    agent.sessionLease.assertOwned();
  } finally {
    Date.now = originalNow;
    targetLease?.release();
    await agent.shutdown();
    await rm(stateDir, { recursive: true, force: true });
    if (previousReliability === undefined) delete process.env.QLING_FEATURES_RELIABILITY_V2;
    else process.env.QLING_FEATURES_RELIABILITY_V2 = previousReliability;
  }
});

test("successful restore transfers the lease only after the target snapshot is applied", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "qling-session-restore-transfer-"));
  const previousReliability = process.env.QLING_FEATURES_RELIABILITY_V2;
  process.env.QLING_FEATURES_RELIABILITY_V2 = "true";
  const agent = createAgent(stateDir);
  try {
    await agent.waitForInit();
    await agent.checkpointSession();
    const previousSessionId = agent.getSessionId();
    await agent.sessionRegistry.save({
      name: "target-session",
      sessionId: "target-session",
      workspaceDir: stateDir,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(1).toISOString(),
      messages: [{ role: "user", content: "restored" }],
      turnCount: 1,
      sessionTokens: 0,
      compactionCount: 0,
    });

    await agent.restoreSession("target-session");
    assert.equal(agent.getSessionId(), "target-session");
    agent.sessionLease.assertOwned();
    const oldSessionLease = SessionLease.acquire({ stateDir, sessionId: previousSessionId, workspaceDir: stateDir });
    oldSessionLease.release();
  } finally {
    await agent.shutdown();
    await rm(stateDir, { recursive: true, force: true });
    if (previousReliability === undefined) delete process.env.QLING_FEATURES_RELIABILITY_V2;
    else process.env.QLING_FEATURES_RELIABILITY_V2 = previousReliability;
  }
});

test("fork save failure releases the target lease and restores the source lease", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "qling-session-fork-rollback-"));
  const previousReliability = process.env.QLING_FEATURES_RELIABILITY_V2;
  process.env.QLING_FEATURES_RELIABILITY_V2 = "true";
  const agent = createAgent(stateDir);
  try {
    await agent.waitForInit();
    await agent.checkpointSession();
    const previousSessionId = agent.getSessionId();
    const originalSave = agent.sessionRegistry.save.bind(agent.sessionRegistry);
    let writes = 0;
    agent.sessionRegistry.save = async (...args) => {
      writes += 1;
      if (writes >= 2) throw new Error("injected save failure");
      return originalSave(...args);
    };

    await assert.rejects(agent.forkSession("broken-fork"), /injected save failure/);
    assert.equal(agent.getSessionId(), previousSessionId);
    agent.sessionLease.assertOwned();
  } finally {
    await agent.shutdown();
    await rm(stateDir, { recursive: true, force: true });
    if (previousReliability === undefined) delete process.env.QLING_FEATURES_RELIABILITY_V2;
    else process.env.QLING_FEATURES_RELIABILITY_V2 = previousReliability;
  }
});
