import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildSavedSessionRecap,
  formatLocalRecap,
  formatRecapMessage,
  parseSavedSessionRecapArgs,
  resolveRecapLimit,
} from "../../dist/recap.js";

test("recap limit resolves safe defaults", () => {
  assert.equal(resolveRecapLimit(undefined), 6);
  assert.equal(resolveRecapLimit("3"), 3);
  assert.equal(resolveRecapLimit("0"), 6);
  assert.equal(resolveRecapLimit("999"), 20);
  assert.equal(resolveRecapLimit("bad"), 6);
});

test("recap message formatter makes compact one-line excerpts", () => {
  assert.equal(formatRecapMessage({ role: "user", content: "hello\nworld" }, 20), "user: hello world");
  assert.equal(formatRecapMessage({ role: "tool", content: { ok: true } }, 40), 'tool: {"ok":true}');
});

test("local recap includes session, goal, task, workspace and recent messages", () => {
  const text = formatLocalRecap({
    stats: { sessionId: "session-abc", turnCount: 4, tokens: 1234, compactions: 1 },
    workspaceDir: "C:\\repo\\qingling",
    goalStatus: { status: "active", condition: "测试通过" },
    activeTasks: [{ id: "tsk_1", status: "active", prompt: "检查构建" }],
    messages: [
      { role: "system", content: "sys" },
      { role: "user", content: "实现 recap" },
      { role: "assistant", content: "已完成" },
    ],
    limit: 2,
  });

  assert.match(text, /本地会话回顾/);
  assert.match(text, /session-abc/);
  assert.match(text, /turns=4/);
  assert.match(text, /tokens=1,234/);
  assert.match(text, /goal=active/);
  assert.match(text, /tasks=1/);
  assert.match(text, /C:\\repo\\qingling/);
  assert.doesNotMatch(text, /system: sys/);
  assert.match(text, /user: 实现 recap/);
  assert.match(text, /assistant: 已完成/);
});

test("local recap degrades cleanly when there are no messages", () => {
  const text = formatLocalRecap({
    stats: { sessionId: "session-empty", turnCount: 0, tokens: 0, compactions: 0 },
    workspaceDir: undefined,
    goalStatus: null,
    activeTasks: [],
    messages: [],
    limit: 6,
  });

  assert.match(text, /goal=none/);
  assert.match(text, /tasks=0/);
  assert.match(text, /最近消息: 无/);
});

test("saved session recap args support latest, count and explicit refs", () => {
  assert.deepEqual(parseSavedSessionRecapArgs([]), { sessionRef: "latest", count: 6 });
  assert.deepEqual(parseSavedSessionRecapArgs(["3"]), { sessionRef: "latest", count: 3 });
  assert.deepEqual(parseSavedSessionRecapArgs(["latest", "2"]), { sessionRef: "latest", count: 2 });
  assert.deepEqual(parseSavedSessionRecapArgs(["session-alpha", "4"]), { sessionRef: "session-alpha", count: 4 });
  assert.deepEqual(parseSavedSessionRecapArgs(["session-alpha", "bad"]), { sessionRef: "session-alpha", count: 6 });
});

test("saved session recap reads latest local snapshot", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qingling-saved-recap-"));
  try {
    const sessionsDir = path.join(stateDir, "sessions");
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.writeFile(
      path.join(sessionsDir, "older.json"),
      JSON.stringify({
        version: 1,
        name: "older",
        sessionId: "sid-older",
        workspaceDir: "C:/repo/older",
        createdAt: "2026-05-31T00:00:00.000Z",
        updatedAt: "2026-05-31T00:00:00.000Z",
        messages: [{ role: "user", content: "old body" }],
        turnCount: 1,
        sessionTokens: 11,
        compactionCount: 0,
      }),
      "utf8"
    );
    await fs.writeFile(
      path.join(sessionsDir, "newer.json"),
      JSON.stringify({
        version: 1,
        name: "newer",
        sessionId: "sid-newer",
        workspaceDir: "C:/repo/newer",
        createdAt: "2026-05-31T00:00:00.000Z",
        updatedAt: "2026-05-31T00:05:00.000Z",
        messages: [
          { role: "user", content: "first local detail" },
          { role: "assistant", content: "latest local detail" },
        ],
        turnCount: 2,
        sessionTokens: 222,
        compactionCount: 1,
      }),
      "utf8"
    );

    const text = await buildSavedSessionRecap(stateDir, { sessionRef: "latest", count: 1 });
    assert.match(text, /本地会话回顾/);
    assert.match(text, /sid-newer/);
    assert.match(text, /C:\/repo\/newer/);
    assert.match(text, /assistant: latest local detail/);
    assert.doesNotMatch(text, /first local detail/);
    assert.doesNotMatch(text, /old body/);
    assert.match(text, /只读取本地已保存会话快照/);
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test("saved session recap reads explicit local snapshot", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qingling-saved-recap-ref-"));
  try {
    const sessionsDir = path.join(stateDir, "sessions");
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.writeFile(
      path.join(sessionsDir, "session-alpha.json"),
      JSON.stringify({
        version: 1,
        name: "session-alpha",
        sessionId: "sid-alpha",
        workspaceDir: "C:/repo/alpha",
        createdAt: "2026-05-31T00:00:00.000Z",
        updatedAt: "2026-05-31T00:00:00.000Z",
        messages: [{ role: "user", content: "alpha local body" }],
        turnCount: 3,
        sessionTokens: 333,
        compactionCount: 0,
      }),
      "utf8"
    );

    const text = await buildSavedSessionRecap(stateDir, { sessionRef: "sid-alpha", count: 6 });
    assert.match(text, /sid-alpha/);
    assert.match(text, /user: alpha local body/);
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test("saved session recap reports missing snapshots without throwing", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qingling-saved-recap-empty-"));
  try {
    const latest = await buildSavedSessionRecap(stateDir, { sessionRef: "latest", count: 6 });
    const explicit = await buildSavedSessionRecap(stateDir, { sessionRef: "missing-session", count: 6 });

    assert.match(latest, /未找到本地会话快照/);
    assert.match(latest, /qling sessions/);
    assert.match(explicit, /未找到本地会话快照/);
    assert.match(explicit, /missing-session/);
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});
