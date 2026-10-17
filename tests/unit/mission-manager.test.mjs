import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { MissionManager, isMissionOwnerAlive } from "../../dist/mission/manager.js";

async function withTempDir(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-mission-"));
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

test("mission manager: exhausted is terminal and retryable", async () => {
  await withTempDir(async (stateDir) => {
    const manager = new MissionManager(stateDir);
    await manager.init();
    const mission = await manager.createMission("Exhausted", "never finished", "session-test");
    await manager.updateStatus(mission.id, "exhausted");
    assert.ok(manager.getMission(mission.id).metrics.endTime);
    const retry = await manager.retryMission(mission.id);
    assert.equal(retry.status, "queued");
  });
});

test("mission manager recovers the previous complete snapshot from backup", async () => {
  await withTempDir(async (stateDir) => {
    const manager = new MissionManager(stateDir);
    await manager.init();
    const mission = await manager.createMission("Recover", "keep state", "session-test");
    await manager.updateStatus(mission.id, "running");
    await fs.writeFile(path.join(stateDir, "missions", `${mission.id}.json`), "{broken", "utf8");

    const restored = new MissionManager(stateDir);
    await restored.init();
    assert.equal(restored.getMission(mission.id)?.status, "queued");
  });
});

test("mission manager serializes 100 concurrent snapshot updates", async () => {
  await withTempDir(async (stateDir) => {
    const manager = new MissionManager(stateDir);
    await manager.init();
    const mission = await manager.createMission("Concurrent", "updates", "session-test");
    await Promise.all(Array.from({ length: 100 }, (_, totalTurns) =>
      manager.updateExecutionSnapshot(mission.id, { metrics: { totalTurns } })
    ));
    const reloaded = new MissionManager(stateDir);
    await reloaded.init();
    assert.equal(reloaded.getMission(mission.id)?.metrics.totalTurns, 99);
  });
});

function missionSnapshot(spec) {
  return {
    sessionId: "session-test",
    description: "d",
    lastContext: [],
    metrics: { startTime: 1, totalTurns: 0, totalTokens: 0, totalToolCalls: 0 },
    createdAt: 1,
    updatedAt: 1,
    ...spec,
  };
}

test("isMissionOwnerAlive probes with signal 0 only", () => {
  const signals = [];
  assert.equal(isMissionOwnerAlive(7, (pid, signal) => {
    signals.push(signal);
    assert.equal(pid, 7);
    return true;
  }), true);
  assert.deepEqual(signals, [0]);

  const deadSignals = [];
  assert.equal(isMissionOwnerAlive(8, (_pid, signal) => {
    deadSignals.push(signal);
    const error = new Error("esrch");
    error.code = "ESRCH";
    throw error;
  }), false);
  assert.deepEqual(deadSignals, [0]);

  const permSignals = [];
  assert.equal(isMissionOwnerAlive(9, (_pid, signal) => {
    permSignals.push(signal);
    const error = new Error("perm");
    error.code = "EPERM";
    throw error;
  }), true);
  assert.deepEqual(permSignals, [0]);
  assert.equal(isMissionOwnerAlive(undefined), false);
  assert.equal(isMissionOwnerAlive(0), false);
});

test("mission reconcile pauses only running missions whose owner is dead", async () => {
  await withTempDir(async (stateDir) => {
    const signals = [];
    const specs = [
      { id: "msn_queued", name: "queued", status: "queued" },
      { id: "msn_paused", name: "paused", status: "paused" },
      { id: "msn_ok", name: "ok", status: "succeeded" },
      { id: "msn_blocked", name: "blocked", status: "blocked" },
      { id: "msn_dead", name: "dead", status: "running", ownerPid: 424242 },
      { id: "msn_legacy", name: "legacy", status: "running" },
    ];
    await fs.mkdir(path.join(stateDir, "missions"), { recursive: true });
    for (const spec of specs) {
      await fs.writeFile(
        path.join(stateDir, "missions", `${spec.id}.json`),
        JSON.stringify(missionSnapshot(spec)),
      );
    }

    const manager = new MissionManager(stateDir, {
      processProbe: (pid, signal) => {
        signals.push({ pid, signal });
        const error = new Error("esrch");
        error.code = "ESRCH";
        throw error;
      },
    });
    await manager.init();

    assert.equal(manager.listMissions().length, specs.length);
    assert.equal(manager.getMission("msn_queued").status, "queued");
    assert.equal(manager.getMission("msn_paused").status, "paused");
    assert.equal(manager.getMission("msn_ok").status, "succeeded");
    assert.equal(manager.getMission("msn_blocked").status, "blocked");
    assert.equal(manager.getMission("msn_dead").status, "paused");
    assert.equal(manager.getMission("msn_legacy").status, "paused");
    assert.deepEqual(signals, [{ pid: 424242, signal: 0 }]);
    const logs = await manager.getMissionLogs("msn_dead");
    assert.equal(logs.some((event) =>
      event.type === "state_changed"
      && event.data.to === "paused"
      && event.data.reason === "interrupted_on_restart"
    ), true);

    const again = new MissionManager(stateDir, {
      processProbe: () => {
        throw new Error("reconcile must not probe a mission that is no longer running");
      },
    });
    await again.init();
    assert.equal(again.listMissions().length, specs.length);
    assert.equal(again.getMission("msn_dead").status, "paused");
    assert.equal(again.getMission("msn_queued").status, "queued");
  });
});

test("mission reconcile pauses an ownerless running mission for explicit resume and keeps a live owner", async () => {
  await withTempDir(async (stateDir) => {
    await fs.mkdir(path.join(stateDir, "missions"), { recursive: true });
    await fs.writeFile(
      path.join(stateDir, "missions", "msn_legacy.json"),
      JSON.stringify(missionSnapshot({ id: "msn_legacy", name: "legacy", status: "running" })),
    );
    await fs.writeFile(
      path.join(stateDir, "missions", "msn_live.json"),
      JSON.stringify(missionSnapshot({ id: "msn_live", name: "live", status: "running", ownerPid: process.pid })),
    );

    const manager = new MissionManager(stateDir, {
      processProbe: (pid, signal) => {
        assert.equal(signal, 0);
        return pid === process.pid;
      },
    });
    await manager.init();
    assert.equal(manager.getMission("msn_legacy").status, "paused");
    assert.equal(manager.getMission("msn_live").status, "running");

    const resumed = await manager.resumeMission("msn_legacy", "operator resume");
    assert.equal(resumed.status, "queued");
    assert.notEqual(resumed.status, "running");
    assert.equal(manager.getMission("msn_live").status, "running");
    const logs = await manager.getMissionLogs("msn_legacy");
    assert.equal(logs.some((event) =>
      event.type === "state_changed"
      && event.data.to === "paused"
      && event.data.reason === "interrupted_on_restart"
    ), true);
    assert.equal(logs.some((event) => event.type === "control" && event.data.action === "resume"), true);
    assert.equal(logs.some((event) => event.type === "state_changed" && event.data.to === "running"), false);
  });
});

test("mission reconcile uses process.kill(pid, 0) and keeps a live owner running", async () => {
  await withTempDir(async (stateDir) => {
    const manager = new MissionManager(stateDir);
    await manager.init();
    const mission = await manager.createMission("Live", "stay running", "session-test");
    await manager.updateStatus(mission.id, "running");
    assert.equal(manager.getMission(mission.id).ownerPid, process.pid);

    const signals = [];
    const original = process.kill;
    process.kill = (pid, signal) => {
      signals.push(signal);
      return original.call(process, pid, signal);
    };
    try {
      const reloaded = new MissionManager(stateDir);
      await reloaded.init();
      assert.equal(reloaded.getMission(mission.id)?.status, "running");
      assert.deepEqual(signals, [0]);
    } finally {
      process.kill = original;
    }
  });
});
