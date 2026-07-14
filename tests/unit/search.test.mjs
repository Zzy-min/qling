import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runSearch, truncateSearchLine, SEARCH_DEFAULT_LIMIT } from "../../dist/tools/search.js";

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "qling-search-test-"));
  const prevWorkspace = process.env.QLING_WORKSPACE_DIR;
  const prevState = process.env.QLING_FILE_STATE_DIR;
  const prevCache = process.env.QLING_FILE_CACHE_DIR;
  try {
    process.env.QLING_WORKSPACE_DIR = dir;
    process.env.QLING_FILE_STATE_DIR = join(dir, ".state");
    process.env.QLING_FILE_CACHE_DIR = join(dir, ".cache");
    await fn(dir);
  } finally {
    if (prevWorkspace === undefined) delete process.env.QLING_WORKSPACE_DIR;
    else process.env.QLING_WORKSPACE_DIR = prevWorkspace;
    if (prevState === undefined) delete process.env.QLING_FILE_STATE_DIR;
    else process.env.QLING_FILE_STATE_DIR = prevState;
    if (prevCache === undefined) delete process.env.QLING_FILE_CACHE_DIR;
    else process.env.QLING_FILE_CACHE_DIR = prevCache;
    await rm(dir, { recursive: true, force: true });
  }
}

test("truncateSearchLine caps long lines with ellipsis", () => {
  const long = "x".repeat(500);
  const out = truncateSearchLine(long, 40);
  assert.equal(out.length, 40);
  assert.match(out, /…$/);
  assert.equal(SEARCH_DEFAULT_LIMIT, 40);
});

test("search: limit=1 truncates high-volume matches without buffer errors", async () => {
  await withTempDir(async (dir) => {
    const bigFile = join(dir, "big.txt");
    const content = Array.from({ length: 2000 }, (_, i) => `line-${i}`).join("\n");
    await writeFile(bigFile, content, "utf-8");

    const result = await runSearch({
      pattern: ".",
      target: "content",
      path: dir,
      limit: 1,
    });

    assert.equal(result.is_error, undefined);
    assert.match(result.output, /truncated at 1 results/);
    assert.doesNotMatch(result.output, /ENOBUFS/i);
  });
});

test("search: context=0 and context=1 produce different output shapes", async () => {
  await withTempDir(async (dir) => {
    const sample = join(dir, "sample.txt");
    await writeFile(sample, "line one\nhello mid\nline three\n", "utf-8");

    const r0 = await runSearch({
      pattern: "hello",
      target: "content",
      path: dir,
      context: 0,
      limit: 10,
    });
    const r1 = await runSearch({
      pattern: "hello",
      target: "content",
      path: dir,
      context: 1,
      limit: 10,
    });

    assert.equal(r0.is_error, undefined);
    assert.equal(r1.is_error, undefined);
    assert.match(r0.output, /sample\.txt:2:hello mid/);
    assert.match(r1.output, /> 2: hello mid/);
    assert.match(r1.output, /1: line one/);
    assert.match(r1.output, /3: line three/);
  });
});

test("search: file_glob filters result files", async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, "a.ts"), "const todo = 'hit';", "utf-8");
    await writeFile(join(dir, "b.md"), "todo in markdown should be ignored", "utf-8");

    const result = await runSearch({
      pattern: "todo",
      target: "content",
      path: dir,
      file_glob: "*.ts",
      limit: 10,
    });

    assert.equal(result.is_error, undefined);
    assert.match(result.output, /a\.ts/);
    assert.doesNotMatch(result.output, /b\.md/);
  });
});

test("search: Windows-style path works on win32", async (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows-only compatibility test");
    return;
  }

  await withTempDir(async (dir) => {
    await writeFile(join(dir, "only.txt"), "hello", "utf-8");
    const winPath = dir.replace(/\//g, "\\");
    const result = await runSearch({
      pattern: "*.txt",
      target: "files",
      path: winPath,
      limit: 10,
    });

    assert.equal(result.is_error, undefined);
    assert.match(result.output, /only\.txt/i);
  });
});

test("search: default ignore directories (node_modules, .git) are excluded", async () => {
  await withTempDir(async (dir) => {
    const nodeModulesDir = join(dir, "node_modules");
    const gitDir = join(dir, ".git");
    const safeDir = join(dir, "safe-dir");

    await mkdir(nodeModulesDir, { recursive: true });
    await mkdir(gitDir, { recursive: true });
    await mkdir(safeDir, { recursive: true });

    await writeFile(join(nodeModulesDir, "bad.txt"), "hello-modules", "utf-8");
    await writeFile(join(gitDir, "bad-git.txt"), "hello-git", "utf-8");
    await writeFile(join(safeDir, "good.txt"), "hello-good", "utf-8");

    // Clear environment variable for workspace dir so it respects our custom dir in native fallback
    const result = await runSearch({
      pattern: "hello",
      target: "content",
      path: dir,
      limit: 10,
    });

    assert.equal(result.is_error, undefined);
    assert.match(result.output, /good\.txt/);
    assert.doesNotMatch(result.output, /bad\.txt/);
    assert.doesNotMatch(result.output, /bad-git\.txt/);
  });
});

test("search: respects gitignore filter when falling back", async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, ".gitignore"), "ignored.txt\n*.log\ntemp-dir/\n", "utf-8");
    await writeFile(join(dir, "allowed.txt"), "hit-allowed", "utf-8");
    await writeFile(join(dir, "ignored.txt"), "hit-ignored", "utf-8");
    await writeFile(join(dir, "test.log"), "hit-log", "utf-8");

    const tempDir = join(dir, "temp-dir");
    await mkdir(tempDir, { recursive: true });
    await writeFile(join(tempDir, "inside.txt"), "hit-inside", "utf-8");

    const result = await runSearch({
      pattern: "hit",
      target: "content",
      path: dir,
      limit: 10,
    });

    assert.equal(result.is_error, undefined);
    assert.match(result.output, /allowed\.txt/);
    assert.doesNotMatch(result.output, /ignored\.txt/);
    assert.doesNotMatch(result.output, /test\.log/);
    assert.doesNotMatch(result.output, /inside\.txt/);
  });
});
