// ============================================================
// WAL 追加日志 单元测试
// ============================================================

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { WriteAheadLog } from "../../dist/memory/wal.js";

let tmpDir;

before(async () => {
  tmpDir = path.join(os.tmpdir(), "ql-test-wal-" + Date.now());
  await fs.mkdir(tmpDir, { recursive: true });
});

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("WriteAheadLog", () => {
  it("should initialize with zero state", async () => {
    const wal = new WriteAheadLog(tmpDir);
    const state = await wal.init();
    assert.equal(state.lastSeq, 0);
    assert.equal(state.lastCheckpointSeq, 0);
    await wal.close();
  });

  it("should append entries with incrementing seq", async () => {
    const wal = new WriteAheadLog(path.join(tmpDir, "a"));
    await wal.init();

    const seq1 = await wal.append("add", { id: "1", content: "hello" });
    const seq2 = await wal.append("add", { id: "2", content: "world" });
    const seq3 = await wal.append("remove", { id: "1" });

    assert.equal(seq1, 1);
    assert.equal(seq2, 2);
    assert.equal(seq3, 3);
    assert.equal(wal.getLastSeq(), 3);
    await wal.close();
  });

  it("should read entries from given seq", async () => {
    const dir = path.join(tmpDir, "b");
    const wal = new WriteAheadLog(dir);
    await wal.init();

    await wal.append("add", { id: "1" });
    await wal.append("add", { id: "2" });
    await wal.append("add", { id: "3" });

    const entries = await wal.readEntries(2);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].seq, 2);
    assert.equal(entries[1].seq, 3);
    await wal.close();
  });

  it("should verify checksums on read", async () => {
    const dir = path.join(tmpDir, "c");
    const wal = new WriteAheadLog(dir);
    await wal.init();

    await wal.append("add", { id: "1" });
    await wal.append("add", { id: "2" });

    // corrupt the WAL file by changing a checksum
    const walPath = path.join(dir, "wal.jsonl");
    let content = await fs.readFile(walPath, "utf-8");
    content = content.replace(/"checksum":"[^"]+"/, '"checksum":"badchecksum"');
    await fs.writeFile(walPath, content, "utf-8");

    const entries = await wal.readEntries(0);
    // corrupted entries are skipped, so we should get 0 or 1
    assert.ok(entries.length <= 1, "corrupted entries should be skipped");
    await wal.close();
  });

  it("should track dirty state", async () => {
    const dir = path.join(tmpDir, "d");
    const wal = new WriteAheadLog(dir);
    await wal.init();

    assert.ok(!wal.isDirty());

    await wal.append("add", { id: "1" });
    assert.ok(wal.isDirty());
    assert.equal(wal.getPendingCount(), 1);

    await wal.checkpoint([{ id: "1", content: "test" }]);
    assert.ok(!wal.isDirty());
    assert.equal(wal.getPendingCount(), 0);
    await wal.close();
  });

  it("should write checkpoint and truncate WAL", async () => {
    const dir = path.join(tmpDir, "e");
    const wal = new WriteAheadLog(dir);
    await wal.init();

    await wal.append("add", { id: "1" });
    await wal.append("add", { id: "2" });
    await wal.append("add", { id: "3" });

    const checkpointData = [{ id: "1" }, { id: "2" }, { id: "3" }];
    await wal.checkpoint(checkpointData);

    // checkpoint file should exist
    const checkpointPath = path.join(dir, "memory.json");
    const data = JSON.parse(await fs.readFile(checkpointPath, "utf-8"));
    assert.equal(data.length, 3);

    // WAL should be truncated
    const entries = await wal.readEntries(0);
    assert.equal(entries.length, 0);
    assert.equal(wal.getLastCheckpointSeq(), 3);
    await wal.close();
  });

  it("writes checkpoints to an explicit canonical path before truncating the WAL", async () => {
    const walDir = path.join(tmpDir, "explicit", "wal");
    const checkpointPath = path.join(tmpDir, "explicit", "memory.json");
    const wal = new WriteAheadLog({ walDir, checkpointPath });
    await wal.init();
    await wal.append("add", { id: "canonical" });

    await wal.checkpoint([{ id: "canonical", content: "restored" }]);

    const data = JSON.parse(await fs.readFile(checkpointPath, "utf-8"));
    assert.equal(data[0].id, "canonical");
    assert.equal((await wal.readEntries(0)).length, 0);
    await assert.rejects(fs.access(path.join(walDir, "memory.json")));
    await wal.close();
  });

  it("should recover state after re-init", async () => {
    const dir = path.join(tmpDir, "f");
    const wal1 = new WriteAheadLog(dir);
    await wal1.init();
    await wal1.append("add", { id: "1" });
    await wal1.append("add", { id: "2" });
    await wal1.close();

    const wal2 = new WriteAheadLog(dir);
    const state = await wal2.init();
    assert.equal(state.lastSeq, 2);
    assert.equal(state.lastCheckpointSeq, 0);
    assert.ok(wal2.isDirty());
    await wal2.close();
  });

  it("should support all operation types", async () => {
    const dir = path.join(tmpDir, "g");
    const wal = new WriteAheadLog(dir);
    await wal.init();

    await wal.append("add", { id: "1", content: "a" });
    await wal.append("update", { id: "1", content: "b" });
    await wal.append("remove", { id: "1" });
    await wal.append("compact", [{ id: "2" }]);

    const entries = await wal.readEntries(0);
    assert.equal(entries.length, 4);
    assert.equal(entries[0].op, "add");
    assert.equal(entries[1].op, "update");
    assert.equal(entries[2].op, "remove");
    assert.equal(entries[3].op, "compact");
    await wal.close();
  });
});
