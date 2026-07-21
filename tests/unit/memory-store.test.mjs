import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MemoryStore } from "../../dist/memory.js";
import { WriteAheadLog } from "../../dist/memory/wal.js";
import { memoryCommand } from "../../dist/commands/memory.js";

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-memory-store-test-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("MemoryStore global/workspace isolation", async () => {
  await withTempDir(async (tempRoot) => {
    const wsADir = path.join(tempRoot, "wsA");
    const wsBDir = path.join(tempRoot, "wsB");
    await fs.mkdir(wsADir);
    await fs.mkdir(wsBDir);

    const memoryDir = path.join(tempRoot, "memory");

    const storeA = new MemoryStore(memoryDir, { workspaceDir: wsADir });
    const storeB = new MemoryStore(memoryDir, { workspaceDir: wsBDir });

    await storeA.init();
    await storeB.init();

    storeA.add("workspace A fact", "test", 0.9, "workspace");
    storeB.add("workspace B fact", "test", 0.9, "workspace");

    await storeA.saveToDisk();
    await storeB.saveToDisk();

    // Reload B to verify B's persistent storage doesn't see A's facts
    const storeB2 = new MemoryStore(memoryDir, { workspaceDir: wsBDir });
    await storeB2.init();

    const wsARelevant = await storeA.getRelevant("fact", 10);
    const wsBRelevant = await storeB2.getRelevant("fact", 10);

    assert(wsARelevant.some(e => e.content === "workspace A fact"), "store A should have A fact");
    assert(!wsARelevant.some(e => e.content === "workspace B fact"), "store A should not have B fact");
    assert(wsBRelevant.some(e => e.content === "workspace B fact"), "store B should have B fact");
    assert(!wsBRelevant.some(e => e.content === "workspace A fact"), "store B should not have A fact");

    // Add global fact through A
    storeA.add("global config fact", "test", 0.9, "global");
    await storeA.saveToDisk();

    // Reload B again
    const storeB3 = new MemoryStore(memoryDir, { workspaceDir: wsBDir });
    await storeB3.init();
    const wsB3Relevant = await storeB3.getRelevant("global", 10);
    assert(wsB3Relevant.some(e => e.content === "global config fact"), "store B should retrieve global fact");

    await storeA.shutdown();
    await storeB.shutdown();
    await storeB2.shutdown();
    await storeB3.shutdown();
  });
});

test("MemoryStore weighted semantic retrieval merging", async () => {
  await withTempDir(async (tempRoot) => {
    const wsDir = path.join(tempRoot, "ws");
    await fs.mkdir(wsDir);

    const memoryDir = path.join(tempRoot, "memory");
    const store = new MemoryStore(memoryDir, { workspaceDir: wsDir });
    await store.init();

    store.add("python 3.12 workspace", "test", 0.5, "workspace");
    store.add("python 3.12 global", "test", 0.5, "global");

    const hits = await store.getRelevant("python", 10);

    assert.equal(hits.length, 2);
    // Workspace fact gets multiplier 1.0 (score = 5 * 1.0 = 5.0)
    // Global fact gets multiplier 0.7 (score = 5 * 0.7 = 3.5)
    // Thus workspace fact should be ranked first
    assert.equal(hits[0].content, "python 3.12 workspace");
    assert.equal(hits[1].content, "python 3.12 global");

    await store.shutdown();
  });
});

test("MemoryStore WAL checkpoint survives a cold restart at the canonical path", async () => {
  await withTempDir(async (tempRoot) => {
    const wsDir = path.join(tempRoot, "ws");
    const memoryDir = path.join(tempRoot, "memory");
    await fs.mkdir(wsDir);

    const first = new MemoryStore(memoryDir, { workspaceDir: wsDir });
    await first.init();
    const wal = new WriteAheadLog({
      walDir: path.join(first.getWorkspaceMemoryDir(), "wal"),
      checkpointPath: path.join(first.getWorkspaceMemoryDir(), "memory.json"),
    });
    await wal.init();
    first.setWAL(wal);
    first.add("checkpoint survives restart", "test", 0.9);
    await first.saveToDisk();
    await first.shutdown();

    const second = new MemoryStore(memoryDir, { workspaceDir: wsDir });
    await second.init();
    assert.equal(second.exportPersisted().length, 1);
    assert.equal(second.exportPersisted()[0].content, "checkpoint survives restart");
    await second.shutdown();
  });
});

test("MemoryStore migrates the misplaced WAL checkpoint once without deleting it", async () => {
  await withTempDir(async (tempRoot) => {
    const wsDir = path.join(tempRoot, "ws");
    const memoryDir = path.join(tempRoot, "memory");
    await fs.mkdir(wsDir);
    const probe = new MemoryStore(memoryDir, { workspaceDir: wsDir });
    const workspaceMemoryDir = probe.getWorkspaceMemoryDir();
    const misplaced = path.join(workspaceMemoryDir, "wal", "memory.json");
    await fs.mkdir(path.dirname(misplaced), { recursive: true });
    await fs.writeFile(misplaced, JSON.stringify([{
      id: "legacy-wal",
      content: "misplaced checkpoint",
      source: "test",
      createdAt: 1,
      importance: 0.8,
    }]), "utf8");

    const first = new MemoryStore(memoryDir, { workspaceDir: wsDir });
    await first.init();
    assert.equal(first.exportPersisted()[0]?.id, "legacy-wal");
    const marker = path.join(workspaceMemoryDir, "wal", "checkpoint-migration-v1.json");
    const firstMarker = await fs.readFile(marker, "utf8");
    await first.shutdown();

    const second = new MemoryStore(memoryDir, { workspaceDir: wsDir });
    await second.init();
    assert.equal(second.exportPersisted().length, 1);
    assert.equal(await fs.readFile(marker, "utf8"), firstMarker);
    await fs.access(misplaced);
    await second.shutdown();
  });
});

test("MemoryStore excludes unrelated ordinary memories but keeps global corrections bounded", async () => {
  await withTempDir(async (tempRoot) => {
    const wsDir = path.join(tempRoot, "ws");
    const store = new MemoryStore(path.join(tempRoot, "memory"), { workspaceDir: wsDir });
    await fs.mkdir(wsDir);
    await store.init();
    store.add("Python dependency resolver notes", "test", 1, "workspace");
    for (let i = 0; i < 5; i++) {
      store.add(`[用户纠错·必须遵守] correction ${i}`, "user-correction", 0.99, "global");
    }

    const hits = await store.getRelevant("unrelated chess opening", 10);
    assert.equal(hits.filter((entry) => entry.source === "test").length, 0);
    assert.equal(hits.filter((entry) => entry.source === "user-correction").length, 3);
    await store.shutdown();
  });
});

test("MemoryStore refuses to overwrite a corrupt canonical memory file", async () => {
  await withTempDir(async (tempRoot) => {
    const wsDir = path.join(tempRoot, "ws");
    const memoryDir = path.join(tempRoot, "memory");
    await fs.mkdir(wsDir);
    const probe = new MemoryStore(memoryDir, { workspaceDir: wsDir });
    const canonical = path.join(probe.getWorkspaceMemoryDir(), "memory.json");
    await fs.mkdir(path.dirname(canonical), { recursive: true });
    await fs.writeFile(canonical, "{not-json", "utf8");

    const store = new MemoryStore(memoryDir, { workspaceDir: wsDir });
    await store.init();
    assert.equal(store.getPersistenceStatus().workspace.readOnly, true);
    store.add("must not replace corrupt data", "test", 1);
    await assert.rejects(store.saveToDisk(), /read-only degraded/i);
    assert.equal(await fs.readFile(canonical, "utf8"), "{not-json");
    await store.shutdown().catch(() => undefined);
  });
});

test("MemoryStore loads a valid backup but remains read-only until repaired", async () => {
  await withTempDir(async (tempRoot) => {
    const wsDir = path.join(tempRoot, "ws");
    const memoryDir = path.join(tempRoot, "memory");
    await fs.mkdir(wsDir);
    const probe = new MemoryStore(memoryDir, { workspaceDir: wsDir });
    const canonical = path.join(probe.getWorkspaceMemoryDir(), "memory.json");
    await fs.mkdir(path.dirname(canonical), { recursive: true });
    await fs.writeFile(canonical, "[] trailing", "utf8");
    await fs.writeFile(`${canonical}.bak`, JSON.stringify([{
      id: "backup-entry",
      content: "recovered from backup",
      source: "test",
      createdAt: 1,
      importance: 0.5,
    }]), "utf8");

    const store = new MemoryStore(memoryDir, { workspaceDir: wsDir });
    await store.init();
    assert.equal(store.exportPersisted()[0]?.id, "backup-entry");
    assert.equal(store.getPersistenceStatus().workspace.readOnly, true);
    await store.shutdown().catch(() => undefined);
  });
});

test("MemoryStore CLI commands manually execute CRUD", async () => {
  await withTempDir(async (tempRoot) => {
    const wsDir = path.join(tempRoot, "ws");
    await fs.mkdir(wsDir);

    const memoryDir = path.join(tempRoot, "memory");
    const store = new MemoryStore(memoryDir, { workspaceDir: wsDir });
    await store.init();

    const outputLines = [];
    const errorLines = [];

    const mockCtx = {
      homeDir: tempRoot,
      writeLine(msg) { outputLines.push(msg); },
      writeError(msg) { errorLines.push(msg); },
      agentLoop: {
        getRuntimeRootDir() { return tempRoot; },
        getMemoryStore() { return store; },
      },
    };

    // 1. Add command
    await memoryCommand.execute(["add", "manual command fact"], mockCtx);
    assert.equal(errorLines.length, 0);
    assert(outputLines.some(l => l.includes("成功添加")), "should output success");

    const entries = store.exportPersisted();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].content, "manual command fact");

    const targetId = entries[0].id;

    outputLines.length = 0;
    await memoryCommand.execute(["workspace", "10"], mockCtx);
    assert(outputLines.some(l => l.includes("Entries  : 1/1")), "workspace report should read the canonical directory");

    // 2. Edit command
    await memoryCommand.execute(["edit", targetId, "updated command fact"], mockCtx);
    assert.equal(store.exportPersisted()[0].content, "updated command fact");

    // 3. Delete command
    await memoryCommand.execute(["delete", targetId], mockCtx);
    assert.equal(store.exportPersisted().length, 0);

    await store.shutdown();
  });
});

test("/memory migrate legacy is dry-run by default and requires an explicit target", async () => {
  await withTempDir(async (tempRoot) => {
    const wsDir = path.join(tempRoot, "ws");
    const memoryDir = path.join(tempRoot, "memory");
    await fs.mkdir(wsDir);
    await fs.mkdir(memoryDir, { recursive: true });
    await fs.writeFile(path.join(memoryDir, "memory.json"), JSON.stringify([{
      id: "legacy-explicit",
      content: "legacy explicit migration",
      source: "legacy",
      createdAt: 1,
      importance: 0.7,
    }]), "utf8");
    const store = new MemoryStore(memoryDir, { workspaceDir: wsDir });
    await store.init();
    const outputLines = [];
    const errorLines = [];
    const ctx = {
      writeLine(line) { outputLines.push(line); },
      writeError(line) { errorLines.push(line); },
      agentLoop: {
        getRuntimeRootDir() { return tempRoot; },
        getMemoryStore() { return store; },
      },
    };

    await memoryCommand.execute(["migrate", "legacy", "--to", "workspace"], ctx);
    assert.equal(store.exportPersisted().length, 0);
    assert(outputLines.some((line) => line.includes("dry-run")));

    await memoryCommand.execute(["migrate", "legacy", "--to", "workspace", "--apply"], ctx);
    assert.equal(errorLines.length, 0);
    assert.equal(store.exportPersisted()[0]?.id, "legacy-explicit");
    await store.shutdown();
  });
});
