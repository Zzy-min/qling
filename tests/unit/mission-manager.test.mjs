import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { MissionManager } from "../../dist/mission/manager.js";

async function withTempDir(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qingling-mission-"));
  try {
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("mission manager: create mission writes snapshot and initial queued event", async () => {
  await withTempDir(async (stateDir) => {
    const manager = new MissionManager(stateDir);
    await manager.init();

    const mission = await manager.createMission("Test Mission", "run checks", "session-test");
    const loaded = manager.getMission(mission.id);
    const logs = await manager.getMissionLogs(mission.id);

    assert.ok(loaded);
    assert.equal(loaded.status, "queued");
    assert.equal(logs.length, 1);
    assert.equal(logs[0].type, "state_changed");
    assert.equal(logs[0].data.to, "queued");
  });
});

test("mission manager: pause, resume, cancel and appendLog are persisted", async () => {
  await withTempDir(async (stateDir) => {
    const manager = new MissionManager(stateDir);
    await manager.init();

    const mission = await manager.createMission("Test Mission", "run checks", "session-test");
    await manager.pauseMission(mission.id, "operator pause");
    await manager.resumeMission(mission.id, "operator resume");
    await manager.appendLog(mission.id, "operator note", { source: "test" });
    await manager.cancelMission(mission.id, "operator cancel");

    const loaded = manager.getMission(mission.id);
    const logs = await manager.getMissionLogs(mission.id);

    assert.ok(loaded);
    assert.equal(loaded.status, "canceled");
    assert.equal(logs.some((event) => event.type === "log" && event.data.message === "operator note"), true);

    const stateChanges = logs.filter((event) => event.type === "state_changed").map((event) => event.data.to);
    assert.deepEqual(stateChanges, ["queued", "paused", "queued", "canceled"]);
  });
});

test("mission manager: invalid lifecycle transitions are rejected", async () => {
  await withTempDir(async (stateDir) => {
    const manager = new MissionManager(stateDir);
    await manager.init();

    const mission = await manager.createMission("Test Mission", "run checks", "session-test");

    await assert.rejects(
      () => manager.resumeMission(mission.id, "should fail"),
      /paused/i
    );
  });
});

test("mission manager: retry clones a terminal mission into a new queued mission", async () => {
  await withTempDir(async (stateDir) => {
    const manager = new MissionManager(stateDir);
    await manager.init();

    const mission = await manager.createMission("Retry Mission", "run checks", "session-test");
    await manager.cancelMission(mission.id, "cancel before retry");

    const retried = await manager.retryMission(mission.id);
    const originalLogs = await manager.getMissionLogs(mission.id);
    const retriedLogs = await manager.getMissionLogs(retried.id);

    assert.notEqual(retried.id, mission.id);
    assert.equal(retried.status, "queued");
    assert.equal(retried.description, mission.description);
    assert.equal(originalLogs.some((event) => event.type === "control" && event.data.action === "retry"), true);
    assert.equal(retriedLogs[0].data.to, "queued");
  });
});
