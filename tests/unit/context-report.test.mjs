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
        promptTokens: 18000,
        completionTokens: 6000,
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
  });

  assert.equal(report.sessionId, "session-test");
  assert.equal(report.turnCount, 3);
  assert.equal(report.messageCount, 2);
  assert.equal(report.tokens, 24000);
  assert.equal(report.promptTokens, 18000);
  assert.equal(report.completionTokens, 6000);
  assert.equal(report.tokenSource, "provider");
  assert.equal(report.compactions, 2);
  assert.match(report.tokenSourceDescription, /官方 usage|provider/i);
  assert.match(report.sessionsDir, /sessions$/);
  assert.equal("maxTokens" in report, false);
  assert.equal("tokenUsagePercent" in report, false);
  assert.ok(report.layers);
  assert.equal(report.layers.messageCount, 2);
  assert.ok(report.layers.historyChars > 0);
});

test("context report handles missing saved sessions", async () => {
  const report = await buildContextReport(createContext({
    listSavedSessions: async () => [],
  }));

  assert.equal(report.savedSessionCount, 0);
  assert.equal(report.latestSavedSessionAt, null);
});

test("context report formatter is readable and local-first", async () => {
  const report = await buildContextReport(createContext());
  const text = formatContextReport(report).join("\n");

  assert.match(text, /轻灵 · 本地上下文/);
  assert.match(text, /会话/);
  assert.match(text, /Token（官方 usage）/);
  assert.match(text, /Harness 层|工具输出|本地字符|占用分类/);
  assert.match(text, /System|Messages|Tools|Free/);
  assert.match(text, /本地路径/);
  assert.match(text, /session-test/);
  assert.match(text, /Token 来源\s*: provider/);
  // 官方 Token 不再使用「Token 预算」口径；本地 harness 可用字符上限估计
  assert.doesNotMatch(text, /Token\s*预算|token budget|%\s*of/i);
  assert.match(text, /边界\s*: \/context 只展示本地统计与路径/);
});

test("context report unknown usage recommends checking provider fields", async () => {
  const report = await buildContextReport(createContext({
    agentLoop: {
      getSessionStats: () => ({
        sessionId: "session-unknown",
        turnCount: 1,
        tokens: 0,
        promptTokens: 0,
        completionTokens: 0,
        tokenSource: "unknown",
        compactions: 0,
      }),
    },
  }));

  assert.equal(report.tokenSource, "unknown");
  assert.match(report.recommendation, /usage|官方/i);
});

test("formatTokenUsage shows provider breakdown without budget denominator", () => {
  assert.match(
    formatTokenUsage({ tokens: 1000, promptTokens: 700, completionTokens: 300, source: "provider" }),
    /1,000.*in 700.*out 300.*provider/
  );
  assert.match(formatTokenUsage({ tokens: 0, source: "unknown" }), /0.*unknown/);
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
