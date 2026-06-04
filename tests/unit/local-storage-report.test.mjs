import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildLocalStorageReport, formatBytes, formatLocalStorageReport } from "../../dist/local-storage-report.js";

function createContext(root) {
  return {
    workspaceDir: join(root, "workspace"),
    agentLoop: {
      getRuntimeRootDir: () => root,
      getWorkspaceDir: () => join(root, "workspace"),
    },
    writeLine: () => {},
    writeError: () => {},
  };
}

async function withTempRoot(fn) {
  const root = await mkdtemp(join(tmpdir(), "qingling-storage-report-"));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("formatBytes keeps storage report readable", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(10 * 1024), "10 KB");
});

test("local storage report marks missing local data directories without failing", async () => {
  await withTempRoot(async (root) => {
    const stateDir = join(root, "missing-state");
    const report = await buildLocalStorageReport(createContext(root), {
      env: {
        QINGLING_FILE_STATE_DIR: stateDir,
        QINGLING_FILE_CACHE_DIR: join(stateDir, "cache"),
      },
    });

    assert.equal(report.stateDir, stateDir);
    assert.equal(report.buckets.find((bucket) => bucket.id === "state").exists, false);
    assert.equal(report.buckets.find((bucket) => bucket.id === "sessions").exists, false);
    assert.equal(report.buckets.find((bucket) => bucket.id === "exports").exists, false);
    assert.equal(report.buckets.find((bucket) => bucket.id === "cache").exists, false);
  });
});

test("local storage report scans metadata for state buckets", async () => {
  await withTempRoot(async (root) => {
    const sessionsDir = join(root, "sessions");
    const exportsDir = join(root, "exports");
    const cacheDir = join(root, "cache");
    await mkdir(sessionsDir, { recursive: true });
    await mkdir(exportsDir, { recursive: true });
    await mkdir(cacheDir, { recursive: true });
    await writeFile(join(sessionsDir, "session.json"), "SESSION_BODY_SECRET", "utf8");
    await writeFile(join(exportsDir, "export.md"), "EXPORT_BODY_SECRET", "utf8");
    await writeFile(join(cacheDir, "cache.bin"), "CACHE_BODY_SECRET", "utf8");

    const report = await buildLocalStorageReport(createContext(root), {
      env: {
        QINGLING_FILE_STATE_DIR: root,
        QINGLING_FILE_CACHE_DIR: cacheDir,
      },
    });
    const sessions = report.buckets.find((bucket) => bucket.id === "sessions");
    const exports = report.buckets.find((bucket) => bucket.id === "exports");
    const cache = report.buckets.find((bucket) => bucket.id === "cache");

    assert.equal(sessions.exists, true);
    assert.equal(sessions.fileCount, 1);
    assert.equal(exports.exists, true);
    assert.equal(exports.fileCount, 1);
    assert.equal(cache.exists, true);
    assert.equal(cache.fileCount, 1);
    assert.ok(report.buckets.find((bucket) => bucket.id === "state").sizeBytes >= sessions.sizeBytes + exports.sizeBytes + cache.sizeBytes);

    const output = formatLocalStorageReport(report).join("\n");
    assert.match(output, /本地存储盘点/);
    assert.match(output, /sessions/);
    assert.match(output, /exports/);
    assert.match(output, /cache/);
    assert.match(output, /Size\s*:/);
    assert.doesNotMatch(output, /SESSION_BODY_SECRET|EXPORT_BODY_SECRET|CACHE_BODY_SECRET/);
  });
});

test("local storage report marks buckets truncated at scan limit", async () => {
  await withTempRoot(async (root) => {
    const sessionsDir = join(root, "sessions");
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(join(sessionsDir, "a.json"), "a", "utf8");
    await writeFile(join(sessionsDir, "b.json"), "b", "utf8");

    const report = await buildLocalStorageReport(createContext(root), {
      maxEntries: 1,
      env: {
        QINGLING_FILE_STATE_DIR: root,
        QINGLING_FILE_CACHE_DIR: join(root, "cache"),
      },
    });

    assert.equal(report.buckets.find((bucket) => bucket.id === "sessions").truncated, true);
    assert.match(formatLocalStorageReport(report).join("\n"), /truncated/);
  });
});
