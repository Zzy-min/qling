import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { atomicWriteJson, readJsonWithBackup } from "../../dist/persistence/atomic-json.js";

test("atomic JSON writes are serialized per path and leave no temp files", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-atomic-json-"));
  const file = path.join(dir, "state.json");
  try {
    await Promise.all(Array.from({ length: 100 }, (_, index) =>
      atomicWriteJson(file, { index, payload: "x".repeat(index) }, { backup: true })
    ));
    const primary = JSON.parse(await fs.readFile(file, "utf8"));
    const backup = JSON.parse(await fs.readFile(`${file}.bak`, "utf8"));
    assert.equal(primary.index, 99);
    assert.equal(backup.index, 98);
    assert.equal((await fs.readdir(dir)).some((name) => name.endsWith(".tmp")), false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("JSON reads fall back to a complete backup after primary corruption", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-atomic-backup-"));
  const file = path.join(dir, "state.json");
  try {
    await atomicWriteJson(file, { version: 1 });
    await atomicWriteJson(file, { version: 2 }, { backup: true });
    await fs.writeFile(file, "{broken", "utf8");
    const restored = await readJsonWithBackup(file);
    assert.equal(restored?.source, "backup");
    assert.equal(restored?.value.version, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
