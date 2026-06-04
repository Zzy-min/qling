import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runRead } from "../../dist/tools/read.js";
import { runWrite } from "../../dist/tools/write.js";
import { runBash } from "../../dist/tools/bash.js";
import { runSearch } from "../../dist/tools/search.js";

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "qling-tool-boundary-"));
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

test("read: empty path returns machine-friendly error code", async () => {
  const result = await runRead({ path: "" });
  assert.equal(result.is_error, true);
  assert.match(result.output, /^Error: \[READ_INVALID_PATH\]/);
});

test("read: binary-like file is rejected", async () => {
  await withTempDir(async (dir) => {
    const p = join(dir, "bin.dat");
    await writeFile(p, Buffer.from([0x00, 0x01, 0x02]));
    const result = await runRead({ path: p });
    assert.equal(result.is_error, true);
    assert.match(result.output, /^Error: \[READ_BINARY_FILE\]/);
  });
});

test("write: oversized content is rejected", async () => {
  const huge = "x".repeat(300 * 1024);
  const result = await runWrite({ path: "tmp.txt", content: huge });
  assert.equal(result.is_error, true);
  assert.match(result.output, /^Error: \[WRITE_CONTENT_TOO_LARGE\]/);
});

test("write: dangerous path is rejected", async () => {
  const result = await runWrite({ path: "/etc/passwd", content: "x" });
  assert.equal(result.is_error, true);
  assert.match(result.output, /^Error: \[(WRITE_DANGEROUS_PATH|WRITE_OUTSIDE_ALLOWED_ROOT)\]/);
});

test("bash: empty command is rejected", async () => {
  const result = await runBash({ command: "" });
  assert.equal(result.is_error, true);
  assert.match(result.output, /^Error: \[BASH_EMPTY_COMMAND\]/);
});

test("bash: invalid cwd is rejected", async () => {
  const result = await runBash({ command: "echo hi", cwd: "Z:/definitely/not/exist/path" });
  assert.equal(result.is_error, true);
  assert.match(result.output, /^Error: \[(BASH_CWD_NOT_FOUND|BASH_OUTSIDE_ALLOWED_ROOT)\]/);
});

test("search: empty pattern is rejected", async () => {
  const result = await runSearch({ pattern: "", target: "content" });
  assert.equal(result.is_error, true);
  assert.match(result.output, /^Error: \[SEARCH_EMPTY_PATTERN\]/);
});

test("bash: command too long is rejected", async () => {
  await withTempDir(async () => {
    const longCmd = "echo " + "x".repeat(5001);
    const result = await runBash({ command: longCmd });
    assert.equal(result.is_error, true);
    assert.match(result.output, /^Error: \[BASH_COMMAND_TOO_LONG\]/);
  });
});

test("bash: timeout kills long-running command", async () => {
  await withTempDir(async () => {
    const cmd = process.platform === "win32" ? "ping -n 10 127.0.0.1" : "sleep 10";
    const result = await runBash({ command: cmd, timeout: 1 });
    assert.equal(result.is_error, true);
    assert.match(result.output, /^Error: \[BASH_TIMEOUT\]/);
  });
});

test("read: file exceeding 2MB is rejected", async () => {
  await withTempDir(async (dir) => {
    const p = join(dir, "huge.txt");
    // Write a file just over 2MB
    const chunk = "A".repeat(1024);
    const { appendFile } = await import("node:fs/promises");
    for (let i = 0; i < 2050; i++) {
      await appendFile(p, chunk);
    }
    const result = await runRead({ path: p });
    assert.equal(result.is_error, true);
    assert.match(result.output, /^Error: \[READ_FILE_TOO_LARGE\]/);
  });
});

test("read: non-existent path returns READ_PATH_NOT_FOUND", async () => {
  const result = await runRead({ path: "Z:/no/such/file/ever.txt" });
  assert.equal(result.is_error, true);
  assert.match(result.output, /^Error: \[(READ_PATH_NOT_FOUND|READ_OUTSIDE_ALLOWED_ROOT)\]/);
});

test("search: non-existent path returns SEARCH_PATH_NOT_FOUND", async () => {
  const result = await runSearch({ pattern: "foo", path: "Z:/no/such/dir/ever" });
  assert.equal(result.is_error, true);
  assert.match(result.output, /^Error: \[(SEARCH_PATH_NOT_FOUND|SEARCH_OUTSIDE_ALLOWED_ROOT)\]/);
});
