import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  formatSessionExportIndex,
  listSessionExportFiles,
  parseSessionExportCount,
} from "../../dist/session-export-index.js";

function createContext(root) {
  return {
    agentLoop: {
      getRuntimeRootDir: () => root,
    },
    writeLine: () => {},
    writeError: () => {},
  };
}

async function withTempRoot(fn) {
  const root = await mkdtemp(join(tmpdir(), "qingling-export-index-"));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("export count parser defaults and clamps safely", () => {
  assert.equal(parseSessionExportCount(), 10);
  assert.equal(parseSessionExportCount("abc"), 10);
  assert.equal(parseSessionExportCount("0"), 10);
  assert.equal(parseSessionExportCount("-1"), 10);
  assert.equal(parseSessionExportCount("2"), 2);
  assert.equal(parseSessionExportCount("99"), 50);
});

test("export index returns empty report when exports directory is missing", async () => {
  await withTempRoot(async (root) => {
    const report = await listSessionExportFiles(createContext(root));
    assert.equal(report.entries.length, 0);
    assert.equal(report.total, 0);
    assert.equal(report.exportsDir, join(root, "exports"));
  });
});

test("export index returns empty report when exports directory has no markdown files", async () => {
  await withTempRoot(async (root) => {
    await mkdir(join(root, "exports"), { recursive: true });
    await writeFile(join(root, "exports", "note.txt"), "not an export", "utf8");

    const report = await listSessionExportFiles(createContext(root));
    assert.equal(report.entries.length, 0);
    assert.equal(report.total, 0);
  });
});

test("export index sorts markdown exports newest first and applies count", async () => {
  await withTempRoot(async (root) => {
    const exportsDir = join(root, "exports");
    await mkdir(exportsDir, { recursive: true });
    const oldPath = join(exportsDir, "old.md");
    const newPath = join(exportsDir, "new.md");
    const ignoredPath = join(exportsDir, "ignored.txt");
    await writeFile(oldPath, "old body SECRET_OLD", "utf8");
    await writeFile(newPath, "new body SECRET_NEW", "utf8");
    await writeFile(ignoredPath, "ignore", "utf8");
    await utimes(oldPath, new Date("2026-05-30T00:00:00.000Z"), new Date("2026-05-30T00:00:00.000Z"));
    await utimes(newPath, new Date("2026-05-31T00:00:00.000Z"), new Date("2026-05-31T00:00:00.000Z"));

    const report = await listSessionExportFiles(createContext(root), { count: 1 });

    assert.equal(report.total, 2);
    assert.equal(report.entries.length, 1);
    assert.equal(report.entries[0].name, "new.md");
    assert.equal(report.entries[0].path, newPath);
    assert.equal(report.truncated, true);
  });
});

test("export index formatter shows metadata only and empty-state guidance", async () => {
  await withTempRoot(async (root) => {
    const exportsDir = join(root, "exports");
    await mkdir(exportsDir, { recursive: true });
    const exportPath = join(exportsDir, "session-a.md");
    await writeFile(exportPath, "message body SECRET_BODY_SHOULD_NOT_APPEAR", "utf8");
    await utimes(exportPath, new Date("2026-05-31T01:00:00.000Z"), new Date("2026-05-31T01:00:00.000Z"));

    const report = await listSessionExportFiles(createContext(root), { count: 10 });
    const output = formatSessionExportIndex(report).join("\n");

    assert.match(output, /本地导出列表/);
    assert.match(output, /session-a\.md/);
    assert.match(output, /文件名\s*:/);
    assert.match(output, /修改时间\s*:/);
    assert.match(output, /大小\s*:/);
    assert.match(output, /绝对路径\s*:/);
    assert.match(output, /exports/);
    assert.doesNotMatch(output, /SECRET_BODY_SHOULD_NOT_APPEAR/);

    const emptyOutput = formatSessionExportIndex({
      exportsDir,
      entries: [],
      total: 0,
      requestedCount: 10,
      truncated: false,
    }).join("\n");
    assert.match(emptyOutput, /还没有导出/);
    assert.match(emptyOutput, /\/export/);
  });
});
