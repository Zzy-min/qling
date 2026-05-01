import test from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";

import { isWithinAllowedRoots, resolveToolPath } from "../../dist/runtime-paths.js";

const ROOTS = {
  workspaceDir: resolve(join(process.cwd(), ".tmp-runtime-workspace")),
  fileCacheDir: resolve(join(process.cwd(), ".tmp-runtime-state/cache")),
  fileStateDir: resolve(join(process.cwd(), ".tmp-runtime-state")),
};

test("runtime-paths: alias path resolves to mapped roots", () => {
  const p1 = resolveToolPath("workspace_dir/src/index.ts", ROOTS, "workspace");
  const p2 = resolveToolPath("file_cache_dir/a.txt", ROOTS, "workspace");
  const p3 = resolveToolPath("file_state_dir/memory.json", ROOTS, "workspace");
  assert.equal(p1, resolve(join(ROOTS.workspaceDir, "src/index.ts")));
  assert.equal(p2, resolve(join(ROOTS.fileCacheDir, "a.txt")));
  assert.equal(p3, resolve(join(ROOTS.fileStateDir, "memory.json")));
});

test("runtime-paths: default root fallback uses workspace", () => {
  const p = resolveToolPath("relative/file.txt", ROOTS, "workspace");
  assert.equal(p, resolve(join(ROOTS.workspaceDir, "relative/file.txt")));
});

test("runtime-paths: outside path detection works", () => {
  const inside = resolve(join(ROOTS.workspaceDir, "a/b.txt"));
  const outside = resolve(join(process.cwd(), "..", ".tmp-runtime-outside/secret.txt"));
  assert.equal(isWithinAllowedRoots(inside, ROOTS), true);
  assert.equal(isWithinAllowedRoots(outside, ROOTS), false);
});
