// ============================================================
// Projection Worker 单元测试
// ============================================================

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { WriteAheadLog } from "../../dist/memory/wal.js";
import { ProjectionWorker } from "../../dist/memory/projection-worker.js";

let tmpDir;

before(async () => {
  tmpDir = path.join(os.tmpdir(), "ql-test-proj-" + Date.now());
  await fs.mkdir(tmpDir, { recursive: true });
});

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("ProjectionWorker", () => {
  it("should replay WAL entries on projectOnce", async () => {
    const walDir = path.join(tmpDir, "replay");
    const wal = new WriteAheadLog(walDir);
    await wal.init();

    const appliedEntries = [];
    const worker = new ProjectionWorker(wal, {
      applyEntry: (entry) => appliedEntries.push(entry),
      getEntries: () => appliedEntries.map((e) => e.data),
    }, { intervalMs: 1000 });

    await wal.append("add", { id: "1", content: "hello", source: "test", createdAt: Date.now(), importance: 0.5 });
    await wal.append("add", { id: "2", content: "world", source: "test", createdAt: Date.now(), importance: 0.5 });

    const count = await worker.projectOnce();
    assert.equal(count, 2);
    assert.equal(appliedEntries.length, 2);
    assert.ok(!wal.isDirty(), "WAL should be clean after projection");
    await wal.close();
  });

  it("should perform first-run replay from seq 0", async () => {
    const walDir = path.join(tmpDir, "first-run");
    const wal = new WriteAheadLog(walDir);
    await wal.init();

    await wal.append("add", { id: "1", content: "first", source: "test", createdAt: Date.now(), importance: 0.5 });
    await wal.checkpoint([{ id: "1", content: "first", source: "test", createdAt: Date.now(), importance: 0.5 }]);

    await wal.append("add", { id: "2", content: "second", source: "test", createdAt: Date.now(), importance: 0.5 });

    const applied = [];
    const worker = new ProjectionWorker(wal, {
      applyEntry: (entry) => applied.push(entry),
      getEntries: () => applied.map((e) => e.data),
    });

    // first run should replay from seq 0
    const count = await worker.projectOnce();
    // checkpoint was at seq 1, so only entry seq 2 is pending
    assert.equal(count, 1);
    await wal.close();
  });

  it("should start and stop", async () => {
    const walDir = path.join(tmpDir, "start-stop");
    const wal = new WriteAheadLog(walDir);
    await wal.init();

    const worker = new ProjectionWorker(wal, {
      applyEntry: () => {},
      getEntries: () => [],
    }, { intervalMs: 100 });

    assert.ok(!worker.isRunning());
    worker.start();
    assert.ok(worker.isRunning());
    worker.stop();
    assert.ok(!worker.isRunning());
    await wal.close();
  });

  it("should force checkpoint when dirty", async () => {
    const walDir = path.join(tmpDir, "force-checkpoint");
    const wal = new WriteAheadLog(walDir);
    await wal.init();

    await wal.append("add", { id: "1", content: "test", source: "t", createdAt: Date.now(), importance: 0.5 });

    const worker = new ProjectionWorker(wal, {
      applyEntry: () => {},
      getEntries: () => [{ id: "1", content: "test", source: "t", createdAt: Date.now(), importance: 0.5 }],
    });

    assert.ok(wal.isDirty());
    await worker.forceCheckpoint();
    assert.ok(!wal.isDirty());
    await wal.close();
  });
});
