import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { SessionGoalManager } from "../../dist/session/session-goal-manager.js";
import { SessionGoalController } from "../../dist/session/goal-controller.js";

test("goal controller continues when evaluator says condition is unmet, then stops when achieved", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-goal-controller-"));
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
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-goal-controller-max-"));
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
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-goal-controller-runner-"));
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

test("goal controller uses deterministic outcome evidence before the LLM evaluator", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-goal-evidence-"));
  const manager = new SessionGoalManager({ stateDir, sessionId: "session-goal-evidence", clock: () => 2_000 });
  let llmCalls = 0;
  const controller = new SessionGoalController({
    manager,
    evaluator: { evaluate: async () => { llmCalls += 1; return { done: true, reason: "model says done" }; } },
  });
  await controller.init();
  await controller.setGoal("build passes", { turnCount: 0, tokens: 0 }, {
    contract: {
      objective: "build passes",
      deliverables: [{ id: "build", claim: "npm build succeeds", required: true, maxAgeMs: 1_000 }],
      prohibitedSideEffects: ["external"],
      budget: { maxFailures: 3 },
    },
  });
  const missing = await controller.afterTurn({ transcript: "assistant: done", stats: { turnCount: 1, tokens: 10 }, evidence: [], now: 2_000 });
  assert.equal(missing.status, "continue");
  assert.match(missing.reason, /missing/i);
  assert.equal(llmCalls, 0);

  const achieved = await controller.afterTurn({
    transcript: "assistant: done",
    stats: { turnCount: 2, tokens: 20 },
    evidence: [{ id: "ev-build", claim: "npm build succeeds", source: "command", commandOrTool: "npm run build", observedAt: 1_900, verdict: "pass", scope: "workspace", deterministic: true, redacted: false }],
    now: 2_000,
  });
  assert.equal(achieved.status, "achieved");
  assert.equal(llmCalls, 0);
  assert.deepEqual((await manager.getGoalStatus()).evidenceIds, ["ev-build"]);
});

test("goal controller blocks on deterministic failure even when transcript claims success", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-goal-blocked-"));
  const manager = new SessionGoalManager({ stateDir, sessionId: "session-goal-blocked", clock: () => 3_000 });
  const controller = new SessionGoalController({ manager });
  await controller.init();
  await controller.setGoal("file exists", { turnCount: 0, tokens: 0 }, {
    contract: { objective: "file exists", deliverables: [{ id: "file", claim: "target file exists", required: true }], prohibitedSideEffects: [], budget: {} },
  });
  const result = await controller.afterTurn({
    transcript: "assistant: file created successfully",
    stats: { turnCount: 1, tokens: 10 },
    evidence: [{ id: "ev-missing", claim: "target file exists", source: "filesystem", observedAt: 2_900, verdict: "fail", scope: "workspace", deterministic: true, redacted: false }],
    now: 3_000,
  });
  assert.equal(result.status, "blocked");
  assert.equal((await manager.getGoalStatus()).status, "blocked");
});
