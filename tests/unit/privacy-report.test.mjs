import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildLocalPrivacyReport, formatPrivacyReport } from "../../dist/privacy-report.js";

test("privacy report formatter includes local data paths", () => {
  const lines = formatPrivacyReport({
    workspaceDir: "C:\\repo\\qingling",
    stateDir: "C:\\Users\\Lenovo\\.qingling",
    sessionsDir: "C:\\Users\\Lenovo\\.qingling\\sessions",
    cacheDir: "C:\\Users\\Lenovo\\.qingling\\cache",
    savedSessionCount: 3,
    model: "deepseek-chat",
  });
  const joined = lines.join("\n");

  assert.match(joined, /本地数据留存/);
  assert.match(joined, /C:\\repo\\qingling/);
  assert.match(joined, /C:\\Users\\Lenovo\\.qingling/);
  assert.match(joined, /已存快照\s*: 3/);
  assert.match(joined, /deepseek-chat/);
});

test("privacy report formatter states provider boundary honestly", () => {
  const lines = formatPrivacyReport({
    workspaceDir: "-",
    stateDir: "state",
    sessionsDir: "state\\sessions",
    cacheDir: "state\\cache",
    savedSessionCount: 0,
    model: "unknown",
  });
  const joined = lines.join("\n");

  assert.match(joined, /只读取本地状态/);
  assert.match(joined, /模型请求仍按 provider 配置发送/);
});

test("local privacy report counts saved session summaries without exposing message bodies", async () => {
  const root = mkdtempSync(join(tmpdir(), "qingling-privacy-"));
  try {
    const sessionsDir = join(root, "sessions");
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(
      join(sessionsDir, "session-local.json"),
      JSON.stringify({
        version: 1,
        name: "session-local",
        sessionId: "sid-local",
        workspaceDir: "C:/repo/qingling",
        createdAt: "2026-05-31T00:00:00.000Z",
        updatedAt: "2026-05-31T00:01:00.000Z",
        messages: [{ role: "user", content: "SECRET_PRIVACY_BODY" }],
        turnCount: 1,
        sessionTokens: 42,
        compactionCount: 0,
      }),
      "utf8"
    );

    const report = await buildLocalPrivacyReport({
      workspaceDir: "C:/repo/qingling",
      stateDir: root,
      cacheDir: join(root, "cache"),
      model: "test-model",
    });
    const joined = formatPrivacyReport(report).join("\n");

    assert.equal(report.savedSessionCount, 1);
    assert.match(joined, /已存快照\s*: 1/);
    assert.doesNotMatch(joined, /SECRET_PRIVACY_BODY/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
