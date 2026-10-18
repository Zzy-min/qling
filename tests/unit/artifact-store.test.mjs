import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ContentAddressedArtifactStore } from "../../dist/harness/artifact-store.js";

test("artifact store is content addressed, deduplicated, and rejects unsafe hashes", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "qling-artifacts-"));
  try {
    const store = new ContentAddressedArtifactStore(dir);
    const first = await store.put("large tool output");
    const second = await store.put("large tool output");
    assert.equal(first.hash, second.hash);
    assert.equal((await store.read(first)).toString("utf8"), "large tool output");
    await writeFile(first.path, "tampered", "utf8");
    await assert.rejects(() => store.read(first), /hash mismatch/);
    await assert.rejects(() => store.read({ hash: "../escape" }), /invalid artifact hash/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("artifact store rejects an artifact root redirected outside state", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "qling-artifact-root-"));
  const outside = await mkdtemp(path.join(tmpdir(), "qling-artifact-outside-"));
  try {
    await mkdir(path.join(dir, "artifacts"), { recursive: true });
    await rm(path.join(dir, "artifacts"), { recursive: true });
    try {
      await symlink(outside, path.join(dir, "artifacts"), process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (error?.code === "EPERM") return t.skip("symlink creation is not permitted");
      throw error;
    }
    const store = new ContentAddressedArtifactStore(dir);
    await assert.rejects(() => store.put("secret"), /artifact root/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("artifact store tightens an existing artifact file", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "qling-artifact-mode-"));
  try {
    const store = new ContentAddressedArtifactStore(dir);
    const ref = await store.put("same output");
    if (process.platform !== "win32") await chmod(ref.path, 0o644);
    await store.put("same output");
    if (process.platform !== "win32") assert.equal((await stat(ref.path)).mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
