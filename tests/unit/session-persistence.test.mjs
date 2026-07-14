import test from "node:test";
import assert from "node:assert/strict";

import {
  applySessionSnapshot,
  buildSessionSnapshot,
  defaultSessionSaveName,
} from "../../dist/session/session-persistence.js";

test("buildSessionSnapshot copies live fields", () => {
  const snap = buildSessionSnapshot("demo", {
    sessionId: "sid-1",
    sessionCreatedAt: "2026-01-01T00:00:00.000Z",
    messages: [{ role: "user", content: "hi" }],
    turnCount: 3,
    sessionTokens: 10,
    compactionCount: 1,
    workspaceDir: "C:\\repo",
  });
  assert.equal(snap.name, "demo");
  assert.equal(snap.sessionId, "sid-1");
  assert.equal(snap.turnCount, 3);
  assert.equal(snap.messages[0].content, "hi");
  assert.ok(snap.updatedAt);
});

test("applySessionSnapshot resets token counters and returns summary", () => {
  const patch = applySessionSnapshot({
    version: 1,
    name: "demo",
    sessionId: "sid-2",
    workspaceDir: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    messages: [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
    ],
    turnCount: 5,
    sessionTokens: 99,
    compactionCount: 2,
  });
  assert.equal(patch.sessionId, "sid-2");
  assert.equal(patch.turnCount, 5);
  assert.equal(patch.sessionPromptTokens, 0);
  assert.equal(patch.sessionCompletionTokens, 0);
  assert.equal(patch.tokenUsageSource, "unknown");
  assert.equal(patch.summary.messageCount, 2);
  assert.equal(patch.summary.name, "demo");
});

test("defaultSessionSaveName is stable prefix", () => {
  assert.match(defaultSessionSaveName(new Date("2026-07-14T12:00:00.000Z")), /^session-2026-07-14T/);
});
