import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { RunCheckpointStore } from "../../dist/runtime/run-checkpoint.js";

test("run checkpoint preserves workspace diff and incremental metrics", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qling-checkpoint-workspace-"));
  const state = await fs.mkdtemp(path.join(os.tmpdir(), "qling-checkpoint-state-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.email", "eval@example.invalid"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Qling Eval"], { cwd: root });
    await fs.writeFile(path.join(root, "a.txt"), "before\n");
    execFileSync("git", ["add", "a.txt"], { cwd: root });
    execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
    await fs.writeFile(path.join(root, "a.txt"), "after\n");
    await fs.writeFile(path.join(root, "new.txt"), "new file\n");

    const store = new RunCheckpointStore({ stateDir: state, workspaceDir: root, runId: "run-a" });
    const saved = await store.save({
      sequence: 3,
      phase: "verify",
      progressState: { sequence: 3, phase: "verify", activeMutationId: "mutation-a" },
      usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12, costIsPartial: true, usageIsIncomplete: true, incompleteReasons: ["terminal_result_missing"] },
      toolMetrics: { calls: 4, failures: 1, policyRedirects: 0 },
    });
    assert.match(saved.workspaceDiffArtifact ?? "", /^[a-f0-9]{64}$/);
    assert.match(saved.workspaceDiffFingerprint ?? "", /^[a-f0-9]{64}$/);
    assert.equal(saved.workspaceCaptureAvailable, true);
    assert.match(saved.repositoryHead ?? "", /^[a-f0-9]{40,64}$/);
    assert.match(saved.repositoryTree ?? "", /^[a-f0-9]{40,64}$/);
    assert.match(saved.changedFileHashes["a.txt"] ?? "", /^[a-f0-9]{64}$/);
    assert.match(saved.changedFileHashes["new.txt"] ?? "", /^[a-f0-9]{64}$/);
    const restored = await store.loadLatest();
    assert.equal(restored?.sequence, 3);
    assert.equal(restored?.toolMetrics.calls, 4);
    assert.equal(restored?.usage.totalTokens, 12);
    assert.equal(restored?.progressState?.activeMutationId, "mutation-a");
    assert.deepEqual(await store.assessWorkspace(saved), { consistent: true, mismatches: [] });
    await fs.writeFile(path.join(root, "new.txt"), "changed after checkpoint\n");
    const changedAssessment = await store.assessWorkspace(saved);
    assert.equal(changedAssessment.consistent, false);
    assert.ok(changedAssessment.mismatches.includes("<workspace-diff>"));
    await fs.writeFile(path.join(root, "later.txt"), "created after checkpoint\n");
    const addedAssessment = await store.assessWorkspace(saved);
    assert.equal(addedAssessment.consistent, false);
    assert.ok(addedAssessment.mismatches.includes("<changed-file-set>"));
    const blocked = await store.replaceWithBlockedBaseline({
      sequence: saved.sequence + 1,
      phase: "repair",
      progressState: { sequence: saved.sequence + 1, phase: "repair", activeMutationId: "unknown-mutation", latestVerificationVerdict: "blocked" },
      usage: saved.usage,
      toolMetrics: saved.toolMetrics,
      latestVerification: { verdict: "blocked", fingerprint: "unknown_outcome" },
    }, "test unknown outcome");
    assert.equal((await store.assessWorkspace(blocked)).consistent, true);
    assert.equal((await store.loadLatest())?.progressState?.activeMutationId, "unknown-mutation");
    const checkpointFiles = await fs.readdir(path.join(state, "run-checkpoints"));
    assert.ok(checkpointFiles.some((name) => name.includes(".unknown-") && name.endsWith(".json")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(state, { recursive: true, force: true });
  }
});

test("run checkpoint never treats unavailable git evidence as consistent", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qling-checkpoint-nongit-"));
  const state = await fs.mkdtemp(path.join(os.tmpdir(), "qling-checkpoint-state-"));
  try {
    const store = new RunCheckpointStore({ stateDir: state, workspaceDir: root, runId: "run-nongit" });
    const saved = await store.save({
      sequence: 1,
      phase: "verify",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costIsPartial: true, usageIsIncomplete: true, incompleteReasons: ["workspace_capture_unavailable"] },
      toolMetrics: { calls: 0, failures: 0, policyRedirects: 0 },
    });
    assert.equal(saved.workspaceCaptureAvailable, false);
    const assessment = await store.assessWorkspace(saved);
    assert.equal(assessment.consistent, false);
    assert.ok(assessment.mismatches.includes("<checkpoint-capture-unavailable>"));
    assert.ok(assessment.mismatches.includes("<workspace-capture-unavailable>"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(state, { recursive: true, force: true });
  }
});

test("blocked baseline retains the current mutation fingerprint for fresh re-verification", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qling-checkpoint-blocked-fingerprint-"));
  const state = await fs.mkdtemp(path.join(os.tmpdir(), "qling-checkpoint-blocked-state-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
    await fs.writeFile(path.join(root, "a.txt"), "a\n");
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
    await fs.writeFile(path.join(root, "a.txt"), "b\n");
    const { resolveProjectProfileIdentity } = await import("../../dist/runtime/project-profile.js");
    const identity = await resolveProjectProfileIdentity(root);
    const expected = `${identity.revision}:${identity.dirtyFingerprint}`;
    const store = new RunCheckpointStore({ stateDir: state, workspaceDir: root, runId: "blocked-fingerprint" });
    const saved = await store.replaceWithBlockedBaseline({ sequence: 2, phase: "repair", progressState: { sequence: 2, phase: "repair", activeMutationId: "m:a", activeMutationWorkspaceFingerprint: expected, latestVerificationVerdict: "blocked" }, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costIsPartial: true, usageIsIncomplete: true, incompleteReasons: ["unknown_outcome"] }, toolMetrics: { calls: 1, failures: 0, policyRedirects: 0 }, latestVerification: { verdict: "blocked" } }, "mismatch");
    assert.equal(saved.progressState?.activeMutationWorkspaceFingerprint, expected);
    assert.equal((await store.assessWorkspace(saved)).consistent, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(state, { recursive: true, force: true });
  }
});
