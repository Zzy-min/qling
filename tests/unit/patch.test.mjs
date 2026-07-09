import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runPatch } from "../../dist/tools/patch.js";

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "qling-patch-test-"));
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

test("patch: unique replacement works successfully", async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, "target.txt");
    await writeFile(file, "line1\nline2\nline3\n", "utf-8");

    const result = await runPatch({
      path: "target.txt",
      chunks: [
        {
          search: "line2",
          replace: "line-two-replaced",
        },
      ],
    });

    assert.equal(result.is_error, undefined);
    assert.match(result.output, /applied 1 patch chunk/i);
    assert.match(result.output, /--- target\.txt/);
    assert.match(result.output, /\+\+\+ target\.txt/);
    assert.match(result.output, /@@ -1,4 \+1,4 @@/);
    assert.match(result.output, /-line2/);
    assert.match(result.output, /\+line-two-replaced/);

    const updated = await readFile(file, "utf-8");
    assert.equal(updated, "line1\nline-two-replaced\nline3\n");
  });
});

test("patch: non-unique/multiple occurrences rejects and does not edit file", async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, "target.txt");
    const original = "line1\nline2\nline2\nline3\n";
    await writeFile(file, original, "utf-8");

    const result = await runPatch({
      path: "target.txt",
      chunks: [
        {
          search: "line2",
          replace: "line-two-replaced",
        },
      ],
    });

    assert.equal(result.is_error, true);
    assert.match(result.error?.message, /matches 2 locations/i);
    assert.match(result.error?.message, /more context lines/i);
    assert.match(result.error?.message, /Relevant context from file \(line numbers\)/i); // new diagnostic
    assert.match(result.error?.message, /1: line1/); // line-numbered snippet

    const updated = await readFile(file, "utf-8");
    assert.equal(updated, original);
  });
});

test("patch: zero occurrences rejects and does not edit file", async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, "target.txt");
    const original = "line1\nline2\nline3\n";
    await writeFile(file, original, "utf-8");

    const result = await runPatch({
      path: "target.txt",
      chunks: [
        {
          search: "non-existent-line",
          replace: "should-not-work",
        },
      ],
    });

    assert.equal(result.is_error, true);
    assert.match(result.error?.message, /was not found/i);
    assert.match(result.error?.message, /read.*tool/i);
    assert.match(result.error?.message, /Relevant context from file \(line numbers\)/i); // new diagnostic
    assert.match(result.error?.message, /1: line1/); // snippet with lines

    const updated = await readFile(file, "utf-8");
    assert.equal(updated, original);
  });
});

test("patch: multi-chunk transaction rollbacks if any chunk fails", async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, "target.txt");
    const original = "line1\nline2\nline3\n";
    await writeFile(file, original, "utf-8");

    const result = await runPatch({
      path: "target.txt",
      chunks: [
        {
          search: "line1",
          replace: "line-one-changed",
        },
        {
          search: "non-existent-line",
          replace: "should-not-work",
        },
      ],
    });

    assert.equal(result.is_error, true);
    assert.match(result.error?.message, /was not found/i);

    const updated = await readFile(file, "utf-8");
    // Should NOT have applied even the first chunk
    assert.equal(updated, original);
  });
});

test("patch: outside workspace path validation rejects", async () => {
  await withTempDir(async (dir) => {
    const result = await runPatch({
      path: "../outside-file.txt",
      chunks: [
        {
          search: "hello",
          replace: "world",
        },
      ],
    });

    assert.equal(result.is_error, true);
    assert.match(result.error?.message ?? result.output, /outside (allowed roots|write sandbox)/i);
  });
});

test("patch: empty search is rejected", async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, "target.txt");
    await writeFile(file, "hello\n", "utf-8");
    const result = await runPatch({
      path: "target.txt",
      chunks: [{ search: "", replace: "x" }],
    });
    assert.equal(result.is_error, true);
    assert.match(result.error?.message ?? result.output, /empty search/i);
    assert.equal(await readFile(file, "utf-8"), "hello\n");
  });
});

test("patch: noop when content unchanged is rejected without write", async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, "target.txt");
    const original = "same-line\n";
    await writeFile(file, original, "utf-8");
    const result = await runPatch({
      path: "target.txt",
      chunks: [{ search: "same-line", replace: "same-line" }],
    });
    assert.equal(result.is_error, true);
    assert.match(result.error?.message ?? result.output, /no-op|unchanged/i);
    assert.equal(await readFile(file, "utf-8"), original);
  });
});

test("patch: dry_run returns diff and does not write", async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, "target.txt");
    const original = "line1\nline2\n";
    await writeFile(file, original, "utf-8");
    const result = await runPatch({
      path: "target.txt",
      dry_run: true,
      chunks: [{ search: "line2", replace: "line-two" }],
    });
    assert.equal(result.is_error, undefined);
    assert.match(result.output, /dry_run OK/i);
    assert.match(result.output, /summary: chunks=1/);
    assert.match(result.output, /\+line-two/);
    assert.match(result.output, /no file written/i);
    assert.equal(await readFile(file, "utf-8"), original);
  });
});

test("patch: success includes summary line stats", async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, "target.txt");
    await writeFile(file, "a\nb\n", "utf-8");
    const result = await runPatch({
      path: "target.txt",
      chunks: [{ search: "b", replace: "B" }],
    });
    assert.equal(result.is_error, undefined);
    assert.match(result.output, /summary: chunks=1/);
    assert.match(result.output, /\+/);
  });
});

test("patch: not-found provides suggested search block from actual content", async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, "target.txt");
    const original = "export function calculateTotal(items) {\n  let sum = 0;\n  for (const item of items) {\n    sum += item.price;\n  }\n  return sum;\n}\n";
    await writeFile(file, original, "utf-8");

    // Search has wrong text but overlaps significantly
    const result = await runPatch({
      path: "target.txt",
      chunks: [
        {
          search: "  for (const item of items) {\n    sum += item.amount;\n  }",
          replace: "  for (const item of items) {\n    sum += item.price * item.qty;\n  }",
        },
      ],
    });

    assert.equal(result.is_error, true);
    assert.match(result.error?.message, /was not found/i);
    // New suggestion feature
    assert.match(result.error?.message, /Suggested exact block from file/i);
    assert.match(result.error?.message, /sum \+= item\.price/);  // actual content appears in suggestion
  });
});
