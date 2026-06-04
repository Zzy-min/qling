import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { SessionRegistry } from "../../dist/session/session-registry.js";
import { SessionScheduler } from "../../dist/session/session-scheduler.js";
import { SessionGoalManager } from "../../dist/session/session-goal-manager.js";

test("session resume smoke: checkpoint restores the same session identity for goal/task state", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-session-resume-"));
  const registry = new SessionRegistry({ stateDir });
  const sessionId = "session-resume-smoke";

  await registry.save({
    name: sessionId,
    sessionId,
    workspaceDir: "C:/workspace/qling",
    createdAt: "2026-05-16T00:00:00.000Z",
    updatedAt: "2026-05-16T00:03:00.000Z",
    messages: [{ role: "user", content: "继续修复 build" }],
    turnCount: 3,
    sessionTokens: 800,
    compactionCount: 1,
  });

  const goalManager = new SessionGoalManager({ stateDir, sessionId });
  await goalManager.init();
  await goalManager.setGoal("所有构建测试通过", { turnCount: 3, tokens: 800 });

  const scheduler = new SessionScheduler({
    stateDir,
    sessionId,
    onDue: async () => {},
  });
  await scheduler.init();
  await scheduler.createLoopTask({
    prompt: "检查构建结果",
    intervalMs: 60_000,
    mode: "fixed",
  });

  const restored = await registry.loadLatest();
  assert.equal(restored?.sessionId, sessionId);

  const restoredGoalManager = new SessionGoalManager({ stateDir, sessionId: restored.sessionId });
  await restoredGoalManager.init();
  const restoredGoal = await restoredGoalManager.getGoalStatus();
  assert.equal(restoredGoal?.status, "active");
  assert.equal(restoredGoal?.condition, "所有构建测试通过");

  const restoredScheduler = new SessionScheduler({
    stateDir,
    sessionId: restored.sessionId,
    onDue: async () => {},
  });
  await restoredScheduler.init();
  const tasks = await restoredScheduler.listTasks();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].prompt, "检查构建结果");
});
