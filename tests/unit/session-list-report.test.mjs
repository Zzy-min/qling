import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  formatSessionListReport,
  listLocalSessions,
  parseSessionListCount,
} from "../../dist/session-list-report.js";
import { SessionRegistry } from "../../dist/session/session-registry.js";

async function withTempState(fn) {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-session-list-"));
  try {
    await fn(stateDir);
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
}

test("session list count parser defaults and clamps", () => {
  assert.equal(parseSessionListCount(), 20);
  assert.equal(parseSessionListCount("abc"), 20);
  assert.equal(parseSessionListCount("0"), 20);
  assert.equal(parseSessionListCount("-1"), 20);
  assert.equal(parseSessionListCount("2"), 2);
  assert.equal(parseSessionListCount("999"), 100);
});

test("session list report reads local summaries newest first and applies count", async () => {
  await withTempState(async (stateDir) => {
    const registry = new SessionRegistry({ stateDir });
    await registry.save({
      name: "session-old",
      sessionId: "sid-old",
      workspaceDir: "C:/repo/old",
      createdAt: "2026-05-30T00:00:00.000Z",
      updatedAt: "2026-05-30T00:00:00.000Z",
      messages: [{ role: "user", content: "OLD_SECRET_BODY" }],
      turnCount: 1,
      sessionTokens: 10,
      compactionCount: 0,
    });
    await registry.save({
      name: "session-new",
      sessionId: "sid-new",
      workspaceDir: "C:/repo/new",
      createdAt: "2026-05-31T00:00:00.000Z",
      updatedAt: "2026-05-31T00:00:00.000Z",
      messages: [{ role: "user", content: "NEW_SECRET_BODY" }],
      turnCount: 2,
      sessionTokens: 20,
      compactionCount: 1,
    });

    const report = await listLocalSessions(stateDir, { count: 1 });

    assert.equal(report.total, 2);
    assert.equal(report.sessions.length, 1);
    assert.equal(report.sessions[0].name, "session-new");
    assert.equal(report.truncated, true);
  });
});

test("session list formatter outputs summaries without message bodies", async () => {
  await withTempState(async (stateDir) => {
    const registry = new SessionRegistry({ stateDir });
    await registry.save({
      name: "session-visible",
      sessionId: "sid-visible",
      workspaceDir: "C:/repo/qling",
      createdAt: "2026-05-31T00:00:00.000Z",
      updatedAt: "2026-05-31T00:01:00.000Z",
      messages: [{ role: "user", content: "SECRET_MESSAGE_BODY_SHOULD_NOT_APPEAR" }],
      turnCount: 3,
      sessionTokens: 1234,
      compactionCount: 1,
    });

    const report = await listLocalSessions(stateDir);
    const output = formatSessionListReport(report).join("\n");

    assert.match(output, /本地会话列表/);
    assert.match(output, /session-visible/);
    assert.match(output, /sid-visible/);
    assert.match(output, /turns=3/);
    assert.match(output, /messages=1/);
    assert.match(output, /tokens=1,234/);
    assert.match(output, /C:\/repo\/qling/);
    assert.doesNotMatch(output, /SECRET_MESSAGE_BODY_SHOULD_NOT_APPEAR/);
  });
});

test("session list formatter handles empty local sessions", () => {
  const output = formatSessionListReport({
    stateDir: "C:/empty",
    sessionsDir: "C:/empty/sessions",
    sessions: [],
    total: 0,
    requestedCount: 20,
    truncated: false,
  }).join("\n");

  assert.match(output, /本地会话列表/);
  assert.match(output, /\(无\)/);
});
