import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPatchAnchored, runReadAnchored } from "../../dist/tools/anchored-edit.js";

function saveEnv(keys) {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("anchored edit recovers a uniquely shifted line and writes atomically", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-anchor-"));
  const env = saveEnv([
    "QLING_WORKSPACE_DIR",
    "QLING_FILE_STATE_DIR",
    "QLING_FILE_CACHE_DIR",
    "QLING_SANDBOX_PROFILE",
  ]);
  process.env.QLING_WORKSPACE_DIR = dir;
  process.env.QLING_FILE_STATE_DIR = join(dir, ".state");
  process.env.QLING_FILE_CACHE_DIR = join(dir, ".cache");
  process.env.QLING_SANDBOX_PROFILE = "workspace";
  try {
    const file = join(dir, "demo.txt");
    await writeFile(file, "a\nb\ntarget\nd\ne", "utf8");
    const read = await runReadAnchored({ path: "demo.txt" });
    const revision = read.meta.revision;
    const targetLine = read.output.split("\n").find((line) => line.includes("|target"));
    const anchor = targetLine.split("|")[0];
    await writeFile(file, "new\na\nb\ntarget\nd\ne", "utf8");
    const patched = await runPatchAnchored({
      path: "demo.txt",
      file_revision: revision,
      edits: [{ anchor, replace: "changed" }],
    });
    assert.notEqual(patched.is_error, true);
    assert.match(await readFile(file, "utf8"), /b\nchanged\nd/);
  } finally {
    restoreEnv(env);
    await rm(dir, { recursive: true, force: true });
  }
});

test("anchored edit rejects a stale batch without writing any edit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-anchor-atomic-"));
  const env = saveEnv(["QLING_WORKSPACE_DIR", "QLING_SANDBOX_PROFILE"]);
  process.env.QLING_WORKSPACE_DIR = dir;
  process.env.QLING_SANDBOX_PROFILE = "workspace";
  try {
    const file = join(dir, "demo.txt");
    await writeFile(file, "one\ntwo\nthree", "utf8");
    const read = await runReadAnchored({ path: "demo.txt" });
    const revision = read.meta.revision;
    const valid = read.output.split("\n").find((line) => line.includes("|two")).split("|")[0];
    const result = await runPatchAnchored({
      path: "demo.txt",
      file_revision: revision,
      edits: [
        { anchor: valid, replace: "changed" },
        { anchor: "999:deadbeef", replace: "bad" },
      ],
    });
    assert.equal(result.is_error, true);
    assert.equal(await readFile(file, "utf8"), "one\ntwo\nthree");
  } finally {
    restoreEnv(env);
    await rm(dir, { recursive: true, force: true });
  }
});
