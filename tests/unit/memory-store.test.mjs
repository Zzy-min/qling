import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MemoryStore } from "../../dist/memory.js";
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

    // 2. Edit command
    await memoryCommand.execute(["edit", targetId, "updated command fact"], mockCtx);
    assert.equal(store.exportPersisted()[0].content, "updated command fact");

    // 3. Delete command
    await memoryCommand.execute(["delete", targetId], mockCtx);
    assert.equal(store.exportPersisted().length, 0);

    await store.shutdown();
  });
});
