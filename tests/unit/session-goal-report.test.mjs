import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  clearLocalSessionGoal,
  formatSessionGoalMutation,
  formatSessionGoalReport,
  listLocalSessionGoals,
  setLocalSessionGoal,
} from "../../dist/session-goal-report.js";

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-goal-report-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function writeSession(root, name, overrides = {}) {
  const sessionsDir = path.join(root, "sessions");
  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.writeFile(
    path.join(sessionsDir, `${name}.json`),
    JSON.stringify(
      {
        version: 1,
        name,
        sessionId: name,
        workspaceDir: "C:/repo/qling",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        messages: [{ role: "user", content: "SECRET_GOAL_SESSION_BODY" }],
        turnCount: 4,
        sessionTokens: 200,
        compactionCount: 0,
        ...overrides,
      },
      null,
      2
    ),
    "utf8"
  );
}

async function writeGoal(root, sessionId, goal) {
  const dir = path.join(root, "session-goals");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${sessionId}.json`), JSON.stringify(goal, null, 2), "utf8");
}

function goal(condition, overrides = {}) {
  return {
    condition,
    status: "active",
    runner: "daemon",
    pending: true,
    createdAt: 1_000,
    updatedAt: 1_000,
    baselineTurns: 0,
    baselineTokens: 0,
    evaluatedTurns: 0,
    lastReason: "goal_activated",
    lastDecision: null,
    ...overrides,
  };
}

test("session goal report returns empty report when goals directory is missing", async () => {
  await withTempDir(async (root) => {
    const report = await listLocalSessionGoals(root);
    const output = formatSessionGoalReport(report).join("\n");

    assert.equal(report.totalGoals, 0);
    assert.equal(report.goals.length, 0);
    assert.match(output, /goal set/);
  });
});

test("session goal report sorts by updated time and does not print session bodies", async () => {
  await withTempDir(async (root) => {
    await writeSession(root, "session-new", { updatedAt: "2026-06-01T00:02:00.000Z" });
    await writeGoal(root, "session-old", goal("旧目标", { updatedAt: 1_000 }));
    await writeGoal(root, "session-new", goal("新目标", { updatedAt: 3_000 }));

    const report = await listLocalSessionGoals(root);
    const output = formatSessionGoalReport(report).join("\n");

    assert.deepEqual(report.goals.map((item) => item.sessionId), ["session-new", "session-old"]);
    assert.match(output, /新目标/);
    assert.doesNotMatch(output, /SECRET_GOAL_SESSION_BODY/);
  });
});

test("session goal status resolves latest saved session", async () => {
  await withTempDir(async (root) => {
    await writeSession(root, "session-old", { updatedAt: "2026-06-01T00:01:00.000Z" });
    await writeSession(root, "session-new", { updatedAt: "2026-06-01T00:03:00.000Z" });
    await writeGoal(root, "session-new", goal("最新目标", { updatedAt: 4_000 }));

    const report = await listLocalSessionGoals(root, { sessionRef: "latest" });

    assert.equal(report.goals.length, 1);
    assert.equal(report.goals[0].sessionId, "session-new");
  });
});

test("session goal set defaults to latest saved session with daemon pending goal", async () => {
  await withTempDir(async (root) => {
    await writeSession(root, "session-goal-set", {
      turnCount: 7,
      sessionTokens: 321,
      updatedAt: "2026-06-01T00:05:00.000Z",
    });

    const result = await setLocalSessionGoal(root, "完成 ci:check", { clock: () => 10_000 });
    const output = formatSessionGoalMutation("set", result).join("\n");

    assert.equal(result.sessionId, "session-goal-set");
    assert.equal(result.goal.condition, "完成 ci:check");
    assert.equal(result.goal.runner, "daemon");
    assert.equal(result.goal.pending, true);
    assert.equal(result.goal.baselineTurns, 7);
    assert.equal(result.goal.baselineTokens, 321);
    assert.doesNotMatch(output, /SECRET_GOAL_SESSION_BODY/);
  });
});

test("session goal clear defaults to latest saved session and persists cleared state", async () => {
  await withTempDir(async (root) => {
    await writeSession(root, "session-goal-clear", { updatedAt: "2026-06-01T00:05:00.000Z" });
    await writeGoal(root, "session-goal-clear", goal("待清除目标", { updatedAt: 5_000 }));

    const result = await clearLocalSessionGoal(root, { sessionRef: "latest", clock: () => 11_000 });
    const raw = JSON.parse(await fs.readFile(path.join(root, "session-goals", "session-goal-clear.json"), "utf8"));

    assert.equal(result.goal.status, "cleared");
    assert.equal(raw.status, "cleared");
    assert.equal(raw.pending, false);
    assert.equal(raw.lastReason, "cli_clear");
  });
});

test("session goal set fails clearly when there is no saved session", async () => {
  await withTempDir(async (root) => {
    await assert.rejects(
      () => setLocalSessionGoal(root, "无会话目标"),
      /no saved sessions found/
    );
  });
});
