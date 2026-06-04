import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { formatSessionExportMarkdown, writeSessionExport } from "../../dist/session-export.js";

test("session export markdown includes metadata and messages", () => {
  const markdown = formatSessionExportMarkdown({
    sessionId: "session-abc",
    workspaceDir: "C:\\repo\\qling",
    exportedAt: "2026-05-31T00:00:00.000Z",
    turnCount: 2,
    tokens: 1234,
    compactions: 1,
    messages: [
      { role: "user", content: "你好" },
      { role: "assistant", content: "已处理" },
    ],
  });

  assert.match(markdown, /# qling Session Export/);
  assert.match(markdown, /session-abc/);
  assert.match(markdown, /C:\\repo\\qling/);
  assert.match(markdown, /turns: 2/);
  assert.match(markdown, /tokens: 1,234/);
  assert.match(markdown, /## user/);
  assert.match(markdown, /你好/);
  assert.match(markdown, /## assistant/);
  assert.match(markdown, /已处理/);
});

test("session export markdown degrades when there are no messages", () => {
  const markdown = formatSessionExportMarkdown({
    sessionId: "session-empty",
    workspaceDir: "-",
    exportedAt: "2026-05-31T00:00:00.000Z",
    turnCount: 0,
    tokens: 0,
    compactions: 0,
    messages: [],
  });

  assert.match(markdown, /No messages in current session/);
});

test("session export writes markdown under local exports directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "qling-export-"));
  try {
    const result = await writeSessionExport(
      {
        agentLoop: {
          getRuntimeRootDir: () => root,
          getWorkspaceDir: () => "C:\\repo\\qling",
          getMessagesSnapshot: () => [{ role: "user", content: "导出测试" }],
          getSessionStats: () => ({ sessionId: "session-test", turnCount: 1, tokens: 10, compactions: 0 }),
        },
        writeLine: () => {},
        writeError: () => {},
      },
      { now: () => new Date("2026-05-31T00:00:00.000Z") }
    );
    assert.match(result.path, /exports/);
    assert.match(result.path, /session-test/);
    const content = await readFile(result.path, "utf8");
    assert.match(content, /导出测试/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
