import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getMcpPreset, listMcpPresets } from "../../dist/mcp/presets.js";
import {
  addMcpPresetToStore,
  loadMcpStore,
  mergeMcpServers,
  removeMcpFromStore,
} from "../../dist/mcp/store.js";

test("listMcpPresets includes filesystem and memory", () => {
  const list = listMcpPresets();
  assert.ok(list.length >= 3);
  assert.ok(getMcpPreset("filesystem")?.server?.command);
  assert.ok(getMcpPreset("memory")?.server?.args?.length);
});

test("add and remove mcp preset in temp store", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-mcp-store-"));
  const storePath = join(dir, "mcp-servers.json");
  try {
    const added = await addMcpPresetToStore("filesystem", { storePath });
    assert.equal(added.ok, true);
    const store = await loadMcpStore(storePath);
    assert.ok(store.servers.filesystem);
    assert.equal(store.servers.filesystem.preset, "filesystem");

    const raw = await readFile(storePath, "utf8");
    assert.match(raw, /filesystem/);
    assert.doesNotMatch(raw, /sk-/);

    const removed = await removeMcpFromStore("filesystem", { storePath });
    assert.equal(removed.ok, true);
    const after = await loadMcpStore(storePath);
    assert.equal(after.servers.filesystem, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("mergeMcpServers prefers base over store", () => {
  const merged = mergeMcpServers(
    { filesystem: { command: "custom", args: [], enabled: true } },
    {
      version: 1,
      servers: {
        filesystem: { command: "npx", args: ["x"], enabled: true },
        memory: { command: "npx", args: ["y"], enabled: true },
      },
    }
  );
  assert.equal(merged.filesystem.command, "custom");
  assert.equal(merged.memory.command, "npx");
});

test("add unknown preset fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-mcp-bad-"));
  try {
    const result = await addMcpPresetToStore("no-such-preset", {
      storePath: join(dir, "mcp.json"),
    });
    assert.equal(result.ok, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
