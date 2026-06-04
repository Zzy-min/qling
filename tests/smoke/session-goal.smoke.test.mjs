import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { SessionGoalManager } from "../../dist/session/session-goal-manager.js";
import { SessionGoalController } from "../../dist/session/goal-controller.js";

test("session goal smoke: persists state and reaches achieved after evaluator turns true", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-goal-smoke-"));
  const manager = new SessionGoalManager({ stateDir, sessionId: "session-goal-smoke" });
  const results = [
    { done: false, reason: "还缺测试成功证据" },
    { done: true, reason: "测试成功证据已出现" },
  ];
  const controller = new SessionGoalController({
    manager,
    evaluator: {
      evaluate: async () => results.shift(),
    },
    maxAutoTurns: 4,
  });
  await controller.init();

  const active = await controller.setGoal("所有 auth 测试通过", { turnCount: 1, tokens: 500 });
  assert.equal(active.status, "active");

  const first = await controller.afterTurn({
    transcript: "assistant: 已开始修复",
    stats: { turnCount: 2, tokens: 700 },
  });
  assert.equal(first.status, "continue");

  const second = await controller.afterTurn({
    transcript: "tool: npm test exits 0",
    stats: { turnCount: 3, tokens: 950 },
  });
  assert.equal(second.status, "achieved");

  const stateFile = path.join(stateDir, "session-goals", "session-goal-smoke.json");
  const raw = JSON.parse(await fs.readFile(stateFile, "utf-8"));
  assert.equal(raw.status, "achieved");
  assert.equal(raw.condition, "所有 auth 测试通过");
});
