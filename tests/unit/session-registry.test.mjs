import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { SessionRegistry } from "../../dist/session/session-registry.js";

test("session registry: save, list, load by name/sessionId, and resolve latest", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qingling-session-registry-"));
  const registry = new SessionRegistry({ stateDir });

  await registry.save({
    name: "manual-alpha",
    sessionId: "session-alpha",
    workspaceDir: "C:/workspace/a",
    createdAt: "2026-05-16T00:00:00.000Z",
    updatedAt: "2026-05-16T00:00:00.000Z",
    messages: [{ role: "user", content: "alpha" }],
    turnCount: 1,
    sessionTokens: 120,
    compactionCount: 0,
  });

  const savedPath = await registry.save({
    name: "session-beta",
    sessionId: "session-beta",
    workspaceDir: "C:/workspace/b",
    createdAt: "2026-05-16T00:01:00.000Z",
    updatedAt: "2026-05-16T00:02:00.000Z",
    messages: [
      { role: "user", content: "beta" },
      { role: "assistant", content: "done" },
    ],
    turnCount: 2,
    sessionTokens: 340,
    compactionCount: 1,
  });

  assert.match(savedPath, /session-beta\.json$/);

  const list = await registry.list();
  assert.equal(list.length, 2);
  assert.equal(list[0].name, "session-beta");
  assert.equal(list[0].sessionId, "session-beta");
  assert.equal(list[0].messageCount, 2);
  assert.equal(list[1].name, "manual-alpha");

  const byName = await registry.load("manual-alpha");
  assert.equal(byName?.sessionId, "session-alpha");
  assert.equal(byName?.messages?.length, 1);

  const bySessionId = await registry.load("session-beta");
  assert.equal(bySessionId?.name, "session-beta");
  assert.equal(bySessionId?.turnCount, 2);

  const latest = await registry.loadLatest();
  assert.equal(latest?.name, "session-beta");
  assert.equal(latest?.sessionId, "session-beta");
});
