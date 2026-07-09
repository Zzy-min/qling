import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAutoCommitSubject,
  maybeAutoCommitAfterWrite,
  resolveGitAutoCommitMode,
} from "../../dist/git/auto-commit.js";

test("resolveGitAutoCommitMode defaults to off", () => {
  assert.equal(resolveGitAutoCommitMode({}), "off");
  assert.equal(resolveGitAutoCommitMode({ QLING_GIT_AUTO_COMMIT: "on" }), "on");
  assert.equal(resolveGitAutoCommitMode({ QLING_GIT_AUTO_COMMIT: "ask" }), "ask");
  assert.equal(resolveGitAutoCommitMode({ QLING_GIT_AUTO_COMMIT: "true" }), "on");
});

test("buildAutoCommitSubject is stable and short", () => {
  const s = buildAutoCommitSubject("patch", "src/a.ts");
  assert.match(s, /^qling: patch src\/a\.ts$/);
});

test("maybeAutoCommit off does nothing", async () => {
  const res = await maybeAutoCommitAfterWrite({
    workspaceDir: "C:\\repo",
    filePath: "C:\\repo\\a.ts",
    toolName: "write",
    mode: "off",
    runGit: async () => {
      throw new Error("should not run");
    },
  });
  assert.equal(res.attempted, false);
  assert.equal(res.committed, false);
});

test("maybeAutoCommit ask prompts without committing", async () => {
  const res = await maybeAutoCommitAfterWrite({
    workspaceDir: "C:\\repo",
    filePath: "C:\\repo\\a.ts",
    toolName: "patch",
    mode: "ask",
  });
  assert.equal(res.mode, "ask");
  assert.equal(res.committed, false);
  assert.match(res.message, /\/commit/);
});

test("maybeAutoCommit on commits when git reports dirty path", async () => {
  const calls = [];
  const res = await maybeAutoCommitAfterWrite({
    workspaceDir: "C:\\repo",
    filePath: "C:\\repo\\src\\a.ts",
    toolName: "write",
    mode: "on",
    isGitRepo: () => true,
    runGit: async (args) => {
      calls.push(args);
      if (args[0] === "status") return { stdout: " M src/a.ts\n", stderr: "" };
      return { stdout: "", stderr: "" };
    },
  });
  assert.equal(res.committed, true);
  assert.ok(calls.some((c) => c[0] === "add"));
  assert.ok(calls.some((c) => c[0] === "commit"));
  assert.match(res.message, /已提交/);
});

test("maybeAutoCommit on skips non-git workspace", async () => {
  const res = await maybeAutoCommitAfterWrite({
    workspaceDir: "C:\\not-git",
    filePath: "C:\\not-git\\a.ts",
    toolName: "write",
    mode: "on",
    isGitRepo: () => false,
  });
  assert.equal(res.attempted, false);
  assert.match(res.message, /不是 git 仓库/);
});
