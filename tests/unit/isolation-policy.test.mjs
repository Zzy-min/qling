import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { evaluateIsolationPolicy } from "../../dist/agents/isolation-policy.js";

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "qling-isolation-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("isolation policy: git workspace passes with worktree mode", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, ".git"), { recursive: true });
    const result = await evaluateIsolationPolicy({
      workspaceDir: dir,
      mode: "worktree",
      requireGit: true,
      nonGitPolicy: "warn",
    });
    assert.equal(result.level, "ok");
    assert.equal(result.useWorktree, true);
  });
});

test("isolation policy: non-git workspace warns when non_git_policy=warn", async () => {
  await withTempDir(async (dir) => {
    const result = await evaluateIsolationPolicy({
      workspaceDir: dir,
      mode: "worktree",
      requireGit: true,
      nonGitPolicy: "warn",
    });
    assert.equal(result.level, "warn");
    assert.equal(result.useWorktree, false);
  });
});

test("isolation policy: non-git workspace denies when non_git_policy=deny", async () => {
  await withTempDir(async (dir) => {
    const result = await evaluateIsolationPolicy({
      workspaceDir: dir,
      mode: "worktree",
      requireGit: true,
      nonGitPolicy: "deny",
    });
    assert.equal(result.level, "deny");
    assert.equal(result.useWorktree, false);
  });
});
