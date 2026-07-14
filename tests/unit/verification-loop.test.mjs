import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildVerificationProgress,
  getWorkspaceChangedFiles,
  loadVerificationCommand,
  persistVerificationCommand,
  runWriteToolVerification,
  stagesSummary,
} from "../../dist/execution/verification-loop.js";
import { RecoveryController } from "../../dist/execution/recovery-controller.js";
import { ExecutionEventBus } from "../../dist/execution/event-bus.js";

test("stagesSummary is honest when empty", () => {
  assert.match(stagesSummary(null), /none|未|none/i);
});

test("persist and load verification command roundtrip", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-verify-cfg-"));
  try {
    await persistVerificationCommand(dir, "npm test");
    const loaded = await loadVerificationCommand(dir);
    assert.equal(loaded, "npm test");
    const raw = await readFile(join(dir, ".qling-verify.json"), "utf-8");
    assert.match(raw, /npm test/);
    await persistVerificationCommand(dir, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("buildVerificationProgress uses shell runner results", async () => {
  const progress = await buildVerificationProgress(["t1"], async (cmd) => {
    if (cmd.includes("git diff")) return { code: 0, stdout: "diff-a", stderr: "" };
    if (cmd.includes("git status")) return { code: 0, stdout: " M src/a.ts\n?? b.ts\n", stderr: "" };
    return { code: 1, stdout: "", stderr: "nope" };
  });
  assert.ok(progress.diffHash);
  assert.deepEqual(progress.changedFiles, ["a.ts", "b.ts"]);
  assert.equal(progress.changed, true);
  assert.deepEqual(progress.failingTests, ["t1"]);
});

test("getWorkspaceChangedFiles parses porcelain basenames", async () => {
  const files = await getWorkspaceChangedFiles(async () => ({
    code: 0,
    stdout: " M path/to/foo.ts\nR  old.ts -> new.ts\n",
    stderr: "",
  }));
  assert.deepEqual(files, ["foo.ts", "new.ts"]);
});

test("runWriteToolVerification pauses when staged command fails without progress budget", async () => {
  const recovery = new RecoveryController({ sameFingerprintLimit: 2, strategyAttemptLimit: 4 });
  recovery.startRun({ runId: "r1", sessionId: "s1", originalTask: "fix" });
  const bus = new ExecutionEventBus();
  const events = [];
  bus.subscribe((e) => events.push(e));

  // first failure recovers, second same fingerprint pauses
  const prepared = [
    { call: { id: "1", name: "write", arguments: { path: "a.ts" } } },
  ];
  const runCommand = async () => ({
    code: 1,
    stdout: "FAIL t.test.mjs\n",
    stderr: "failed",
  });

  const first = await runWriteToolVerification(prepared, {
    verificationCommand: "npm test",
    runCommand,
    recoveryController: recovery,
    executionEventBus: bus,
    emit: () => {},
    getRecoveryState: () => {
      try {
        return recovery.getRecoveryState();
      } catch {
        return null;
      }
    },
    verifier: { verify: async () => ({ verdict: "PASS", details: "ok", steps: [] }) },
    messages: [],
    runId: "r1",
  });
  assert.equal(first.kind, "recover");

  const second = await runWriteToolVerification(prepared, {
    verificationCommand: "npm test",
    runCommand,
    recoveryController: recovery,
    executionEventBus: bus,
    emit: () => {},
    getRecoveryState: () => recovery.getRecoveryState(),
    verifier: { verify: async () => ({ verdict: "PASS", details: "ok", steps: [] }) },
    messages: [],
    runId: "r1",
  });
  assert.equal(second.kind, "pause");
  assert.match(second.text, /执行已暂停/);
  assert.ok(events.some((e) => e.type === "verification_failed"));
});
