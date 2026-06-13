import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildContextReport, buildLocalContextReport, formatContextReport, formatTokenUsage } from "../../dist/context-report.js";

function createContext(overrides = {}) {
  return {
    workspaceDir: "C:\\repo\\qling",
    agentLoop: {
      getSessionStats: () => ({
        sessionId: "session-test",
        turnCount: 3,
        tokens: 24000,
        tokenSource: "provider",
        compactions: 2,
      }),
      getMessagesSnapshot: () => [
        { role: "user", content: "hello" },
        { role: "assistant", content: "world" },
      ],
      getRuntimeRootDir: () => "C:\\Users\\Lenovo\\.qling",
      getWorkspaceDir: () => "C:\\repo\\qling",
      ...overrides.agentLoop,
    },
    listSavedSessions: overrides.listSavedSessions ?? (async () => [
      {
        name: "session-test",
        sessionId: "session-test",
        updatedAt: "2026-05-31T10:00:00.000Z",
        turnCount: 3,
        messageCount: 2,
        sessionTokens: 24000,
        compactionCount: 2,
      },
    ]),
    ...overrides,
  };
}

test("context report includes local session statistics and paths", async () => {
  const report = await buildContextReport(createContext(), {
    env: {
      QLING_FILE_STATE_DIR: "C:\\Users\\Lenovo\\.qling",
      QLING_FILE_CACHE_DIR: "C:\\Users\\Lenovo\\.qling\\cache",
    },
    maxTokens: 120000,
  });

  assert.equal(report.sessionId, "session-test");
  assert.equal(report.turnCount, 3);
  assert.equal(report.messageCount, 2);
  assert.equal(report.tokens, 24000);
  assert.equal(report.tokenSource, "provider");
  assert.equal(report.compactions, 2);
  assert.equal(report.tokenUsagePercent, 20);
  assert.equal(report.contextLevel, "ok");
  assert.match(report.recommendation, /正常/);
  assert.match(report.tokenSourceDescription, /provider reported/i);
  assert.match(report.sessionsDir, /sessions$/);
});

test("context report handles missing saved sessions", async () => {
  const report = await buildContextReport(createContext({
    listSavedSessions: async () => [],
  }));

  assert.equal(report.savedSessionCount, 0);
  assert.equal(report.latestSavedSessionAt, null);
});

test("context report formatter is readable and local-first", async () => {
  const report = await buildContextReport(createContext(), { maxTokens: 120000 });
  const text = formatContextReport(report).join("\n");

  assert.match(text, /轻灵 · 本地上下文/);
  assert.match(text, /会话/);
  assert.match(text, /Token 与状态/);
  assert.match(text, /本地路径/);
  assert.match(text, /session-test/);
  assert.match(text, /本地/);
  assert.match(text, /Token 来源\s*: provider/);
  assert.match(text, /上下文状态\s*: ok/);
  assert.match(text, /建议\s*:/);
  assert.match(text, /Token 说明\s*: provider reported/i);
  assert.match(text, /边界\s*: \/context 只展示本地统计与路径/);
});

test("context report classifies watch and critical token usage", async () => {
  const watch = await buildContextReport(createContext({
    agentLoop: {
      getSessionStats: () => ({
        sessionId: "session-watch",
        turnCount: 8,
        tokens: 84000,
        tokenSource: "estimate",
        compactions: 1,
      }),
    },
  }), { maxTokens: 120000 });
  const critical = await buildContextReport(createContext({
    agentLoop: {
      getSessionStats: () => ({
        sessionId: "session-critical",
        turnCount: 12,
        tokens: 110000,
        tokenSource: "unknown",
        compactions: 3,
      }),
    },
  }), { maxTokens: 120000 });

  assert.equal(watch.contextLevel, "watch");
  assert.match(watch.recommendation, /压缩|checkpoint/i);
  assert.match(watch.tokenSourceDescription, /local estimate/i);
  assert.equal(critical.contextLevel, "critical");
  assert.match(critical.recommendation, /立即|compact|checkpoint/i);
  assert.match(critical.tokenSourceDescription, /unknown/i);
});

test("context report marks usage unknown when max token budget is missing", async () => {
  const report = await buildContextReport(createContext({
    agentLoop: {
      getTokenBudget: () => ({ maxTokens: null }),
    },
  }));

  assert.equal(report.contextLevel, "unknown");
  assert.match(report.recommendation, /配置|预算|unknown/i);
});

test("formatTokenUsage degrades for missing or invalid budgets", () => {
  assert.equal(formatTokenUsage(1000, 0), "1,000 / unknown");
  assert.equal(formatTokenUsage(1000, 10000), "1,000 / 10,000 (10%)");
});

test("local context report summarizes saved sessions without exposing message bodies", async () => {
  const root = mkdtempSync(join(tmpdir(), "qling-context-"));
  try {
    const sessionsDir = join(root, "sessions");
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(
      join(sessionsDir, "older.json"),
      JSON.stringify({
        version: 1,
        name: "older",
        sessionId: "sid-older",
        workspaceDir: "C:/repo/qling",
        createdAt: "2026-05-31T00:00:00.000Z",
        updatedAt: "2026-05-31T00:01:00.000Z",
        messages: [{ role: "user", content: "SECRET_CONTEXT_OLDER" }],
        turnCount: 1,
        sessionTokens: 10,
        compactionCount: 0,
      }),
      "utf8"
    );
    writeFileSync(
      join(sessionsDir, "latest.json"),
      JSON.stringify({
        version: 1,
        name: "latest",
        sessionId: "sid-latest",
        workspaceDir: "C:/repo/qling",
        createdAt: "2026-05-31T00:00:00.000Z",
        updatedAt: "2026-05-31T00:02:00.000Z",
        messages: [{ role: "assistant", content: "SECRET_CONTEXT_LATEST" }],
        turnCount: 2,
        sessionTokens: 20,
        compactionCount: 0,
      }),
      "utf8"
    );

    const report = await buildLocalContextReport({
      workspaceDir: "C:/repo/qling",
      stateDir: root,
      cacheDir: join(root, "cache"),
      maxTokens: 120000,
    });
    const text = formatContextReport(report).join("\n");

    assert.equal(report.sessionId, "-");
    assert.equal(report.savedSessionCount, 2);
    assert.equal(report.latestSavedSessionAt, "2026-05-31T00:02:00.000Z");
    assert.match(text, /轻灵 · 本地上下文/);
    assert.match(text, /已存快照\s*: 2/);
    assert.doesNotMatch(text, /SECRET_CONTEXT_/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
