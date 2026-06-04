import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { MissionManager } from "../../dist/mission/manager.js";

const ENTRY = path.join(process.cwd(), "dist/index.js");

test("agents view smoke: agents and logs work without AgentLoop init", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qingling-agents-"));
  try {
    const manager = new MissionManager(stateDir);
    await manager.init();
    const mission = await manager.createMission("Seeded Mission", "seed description", "session-seeded");
    await manager.appendLog(mission.id, "seed log line", { source: "test" });

    const env = {
      ...process.env,
      QINGLING_FILE_STATE_DIR: stateDir,
      OPENAI_API_KEY: "",
      DEEPSEEK_API_KEY: "",
      QINGLING_LLM_API_KEY: "",
    };

    let result = spawnSync(process.execPath, [ENTRY, "agents"], {
      env,
      encoding: "utf-8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Working/);
    assert.match(result.stdout, new RegExp(mission.id));

    result = spawnSync(process.execPath, [ENTRY, "logs", mission.id], {
      env,
      encoding: "utf-8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /seed log line/);

    result = spawnSync(process.execPath, [ENTRY, "代理"], {
      env,
      encoding: "utf-8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Working/);
    assert.match(result.stdout, new RegExp(mission.id));

    result = spawnSync(process.execPath, [ENTRY, "使命", "列表"], {
      env,
      encoding: "utf-8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(mission.id));

    result = spawnSync(process.execPath, [ENTRY, "使命", "日志", mission.id], {
      env,
      encoding: "utf-8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /seed log line/);

    result = spawnSync(process.execPath, [ENTRY, "日志", mission.id], {
      env,
      encoding: "utf-8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /seed log line/);
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});
