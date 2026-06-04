import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { SessionGoalManager } from "../../dist/session/session-goal-manager.js";

test("session goal manager sets, clears, and marks achieved goal", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-goal-manager-"));
  const manager = new SessionGoalManager({ stateDir, sessionId: "session-goal-a", clock: () => 1_000 });
  await manager.init();

  const active = await manager.setGoal("所有测试通过", { turnCount: 4, tokens: 2000 }, { runner: "daemon", pending: true });
  assert.equal(active.status, "active");
  assert.equal(active.condition, "所有测试通过");
  assert.equal(active.baselineTurns, 4);
  assert.equal(active.runner, "daemon");
  assert.equal(active.pending, true);

  const achieved = await manager.markEvaluation({
    done: true,
    reason: "测试输出显示全部通过",
    turnCount: 5,
    tokens: 2300,
  });
  assert.equal(achieved.status, "achieved");
  assert.equal(achieved.lastDecision, "done");
  assert.equal(achieved.pending, false);

  const snapshot = await manager.getGoalStatus();
  assert.equal(snapshot.status, "achieved");
  assert.equal(snapshot.evaluatedTurns, 1);
  assert.equal(snapshot.runner, "daemon");

  const cleared = await manager.clearGoal("user_clear");
  assert.equal(cleared.status, "cleared");
  assert.equal(cleared.lastReason, "user_clear");
});
