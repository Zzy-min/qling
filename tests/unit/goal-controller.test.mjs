import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { SessionGoalManager } from "../../dist/session/session-goal-manager.js";
import { SessionGoalController } from "../../dist/session/goal-controller.js";

test("goal controller continues when evaluator says condition is unmet, then stops when achieved", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qingling-goal-controller-"));
  const manager = new SessionGoalManager({ stateDir, sessionId: "session-goal-b", clock: () => 1_000 });
  const evaluations = [
    { done: false, reason: "还没有看到测试通过证据" },
    { done: true, reason: "对话里已经有通过证据" },
  ];
  const controller = new SessionGoalController({
    manager,
    runner: "session",
    evaluator: {
      evaluate: async () => evaluations.shift(),
    },
    maxAutoTurns: 4,
  });
  await controller.init();
  await controller.setGoal("所有 auth 测试通过", { turnCount: 2, tokens: 1000 }, { runner: "session" });

  const first = await controller.afterTurn({
    transcript: "assistant: 还在修复",
    stats: { turnCount: 3, tokens: 1300 },
  });
  assert.equal(first.status, "continue");
  assert.match(first.continuePrompt, /所有 auth 测试通过/);
  assert.match(first.reason, /测试通过证据/);

  const second = await controller.afterTurn({
    transcript: "tool: npm test exits 0",
    stats: { turnCount: 4, tokens: 1600 },
  });
  assert.equal(second.status, "achieved");
  assert.equal(second.continuePrompt, null);
});

test("goal controller clears active goal when max auto turns is exceeded", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qingling-goal-controller-max-"));
  const manager = new SessionGoalManager({ stateDir, sessionId: "session-goal-c", clock: () => 1_000 });
  const controller = new SessionGoalController({
    manager,
    runner: "session",
    evaluator: {
      evaluate: async () => ({ done: false, reason: "条件未满足" }),
    },
    maxAutoTurns: 1,
  });
  await controller.init();
  await controller.setGoal("完成 lint", { turnCount: 5, tokens: 2000 }, { runner: "session" });

  const result = await controller.afterTurn({
    transcript: "assistant: 继续修复中",
    stats: { turnCount: 7, tokens: 2600 },
  });
  assert.equal(result.status, "cleared");
  assert.match(result.reason, /max auto turns/i);

  const snapshot = await manager.getGoalStatus();
  assert.equal(snapshot.status, "cleared");
});

test("goal controller ignores active goal owned by a different runner", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qingling-goal-controller-runner-"));
  const manager = new SessionGoalManager({ stateDir, sessionId: "session-goal-runner", clock: () => 1_000 });
  const localController = new SessionGoalController({
    manager,
    runner: "session",
    evaluator: {
      evaluate: async () => ({ done: false, reason: "should not run" }),
    },
    maxAutoTurns: 3,
  });
  await localController.init();
  await localController.setGoal("后台目标", { turnCount: 1, tokens: 100 }, { runner: "daemon", pending: true });

  const result = await localController.afterTurn({
    transcript: "assistant: 本地继续中",
    stats: { turnCount: 2, tokens: 200 },
  });
  assert.equal(result.status, "idle");

  const snapshot = await manager.getGoalStatus();
  assert.equal(snapshot.runner, "daemon");
  assert.equal(snapshot.evaluatedTurns, 0);
});
