import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  appendInputHistory,
  loadInputHistory,
  resolveInputHistoryPath,
  shouldPersistInputHistory,
} from "../../dist/tui/input-history.js";

async function withTempState(fn) {
  const root = await mkdtemp(join(tmpdir(), "qingling-input-history-"));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("input history load returns empty list when file is missing", async () => {
  await withTempState(async (stateDir) => {
    assert.deepEqual(await loadInputHistory({ stateDir }), []);
  });
});

test("input history load returns empty list when file is corrupt", async () => {
  await withTempState(async (stateDir) => {
    await writeFile(resolveInputHistoryPath(stateDir), "{not-json", "utf8");

    assert.deepEqual(await loadInputHistory({ stateDir }), []);
  });
});

test("input history append writes local JSON history", async () => {
  await withTempState(async (stateDir) => {
    await appendInputHistory("first prompt", { stateDir });
    await appendInputHistory("second prompt", { stateDir });

    assert.deepEqual(await loadInputHistory({ stateDir }), ["first prompt", "second prompt"]);
    const raw = await readFile(resolveInputHistoryPath(stateDir), "utf8");
    assert.match(raw, /first prompt/);
  });
});

test("input history keeps latest entries when max entries is exceeded", async () => {
  await withTempState(async (stateDir) => {
    await appendInputHistory("one", { stateDir, maxEntries: 2 });
    await appendInputHistory("two", { stateDir, maxEntries: 2 });
    await appendInputHistory("three", { stateDir, maxEntries: 2 });

    assert.deepEqual(await loadInputHistory({ stateDir, maxEntries: 2 }), ["two", "three"]);
  });
});

test("input history deduplicates entries and moves repeated input to latest", async () => {
  await withTempState(async (stateDir) => {
    await appendInputHistory("build", { stateDir });
    await appendInputHistory("test", { stateDir });
    await appendInputHistory("build", { stateDir });

    assert.deepEqual(await loadInputHistory({ stateDir }), ["test", "build"]);
  });
});

test("input history preserves multiline prompt text", async () => {
  await withTempState(async (stateDir) => {
    await appendInputHistory("plan\nthen implement", { stateDir });

    assert.deepEqual(await loadInputHistory({ stateDir }), ["plan\nthen implement"]);
  });
});

test("input history skips obvious sensitive input", async () => {
  await withTempState(async (stateDir) => {
    assert.equal(shouldPersistInputHistory("set api_key sk-1234567890"), false);
    assert.equal(shouldPersistInputHistory("Authorization: Bearer abcdef"), false);
    assert.equal(shouldPersistInputHistory("ordinary prompt"), true);

    await appendInputHistory("set token=secret-value", { stateDir });

    assert.deepEqual(await loadInputHistory({ stateDir }), []);
  });
});

test("input history respects disabled environment flag", async () => {
  await withTempState(async (stateDir) => {
    const env = { QINGLING_TUI_HISTORY_ENABLED: "false" };

    await appendInputHistory("will not persist", { stateDir, env });

    assert.deepEqual(await loadInputHistory({ stateDir, env }), []);
  });
});
