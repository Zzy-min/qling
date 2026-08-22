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
  runAdvisoryVerification,
  stagesSummary,
} from "../../dist/execution/verification-loop.js";
import { RecoveryController } from "../../dist/execution/recovery-controller.js";
import { ExecutionEventBus } from "../../dist/execution/event-bus.js";

test("stagesSummary is honest when empty", () => {
  assert.match(stagesSummary(null), /none|未|none/i);
});

test("advisory verification treats structured tool errors as FAIL without consulting LLM", async () => {
  const emitted = [];
  let verifierCalled = false;
  await runAdvisoryVerification({
    messages: [{
      role: "tool",
      content: JSON.stringify({ output: "forbidden", is_error: true }),
      tool_call_id: "tool-1",
    }],
    verifier: {
      verify: async () => {
        verifierCalled = true;
        return { verdict: "PASS", details: "wrong", steps: [] };
      },
    },
    emit: (...args) => emitted.push(args),
  });
  assert.equal(verifierCalled, false);
  assert.equal(emitted[0]?.[1], "FAIL");
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

test("configured verifier cannot pass when timeout leaves process-tree outcome unknown", async () => {
  const recovery = new RecoveryController({ sameFingerprintLimit: 2, strategyAttemptLimit: 2 });
  recovery.startRun({ runId: "timeout-verifier", sessionId: "session", originalTask: "fix" });
  const outcome = await runWriteToolVerification(
    [{ call: { id: "write-timeout", name: "write", arguments: { path: "a.ts" } } }],
    {
      verificationCommand: "npm test",
      runCommand: async () => ({ code: 0, stdout: "looks green", stderr: "", timedOut: true, terminationConfirmed: false }),
      recoveryController: recovery,
      executionEventBus: new ExecutionEventBus(),
      emit() {},
      getRecoveryState: () => recovery.getRecoveryState(),
      verifier: { verify: async () => ({ verdict: "PASS", details: "ok", steps: [] }) },
      messages: [],
      runId: "timeout-verifier",
    },
  );
  assert.notEqual(outcome.kind, "pass");
});

test("degraded project preflight requests a post-mutation audit before pausing", async () => {
  const recovery = new RecoveryController();
  recovery.startRun({ runId: "blocked-verifier", sessionId: "session", originalTask: "fix" });
  let commandCalls = 0;
  const outcome = await runWriteToolVerification(
    [{ call: { id: "write-blocked", name: "write", arguments: { path: "module.py" } } }],
    {
      verificationCommand: null,
      projectProfile: {
        revision: "r", dirtyFingerprint: "d", parserVersion: "test",
        ecosystems: ["python"], manifests: ["pyproject.toml"], lockfiles: [], testCommands: [],
        runtime: "native", environmentStatus: "degraded",
        blockers: ["Python test bootstrap modules unavailable in native: hypothesis"],
      },
      workspaceDir: process.cwd(),
      observations: [{ tool: "write", failed: false, mutation: "updated", mutationId: "m", changedPaths: ["module.py"] }],
      runCommand: async () => { commandCalls++; return { code: 0, stdout: "", stderr: "" }; },
      recoveryController: recovery,
      executionEventBus: new ExecutionEventBus(),
      emit() {},
      getRecoveryState: () => recovery.getRecoveryState(),
      verifier: { verify: async () => ({ verdict: "PASS", details: "advisory only", steps: [] }) },
      messages: [],
      runId: "blocked-verifier",
    },
  );
  assert.equal(outcome.kind, "audit");
  assert.match(outcome.kind === "audit" ? outcome.text : "", /hypothesis/);
  assert.match(outcome.kind === "audit" ? outcome.text : "", /diff|反向|边界|静态/iu);
  assert.match(outcome.kind === "audit" ? outcome.text : "", /逐条[\s\S]*(?:用户|issue).*要求/iu);
  assert.match(outcome.kind === "audit" ? outcome.text : "", /下游.*(?:消费|调用)/u);
  assert.match(outcome.kind === "audit" ? outcome.text : "", /反例|负向/u);
  assert.equal(commandCalls, 0);
});

test("removed stdlib imports pause as an incompatible verification environment", async () => {
  const recovery = new RecoveryController({ sameFingerprintLimit: 2, strategyAttemptLimit: 4 });
  recovery.startRun({ runId: "old-python-verifier", sessionId: "session", originalTask: "fix" });
  const events = [];
  const bus = new ExecutionEventBus();
  bus.subscribe((event) => events.push(event));
  const outcome = await runWriteToolVerification(
    [{ call: { id: "write-old-python", name: "write", arguments: { path: "requests/sessions.py" } } }],
    {
      verificationCommand: "python -m pytest -q test_requests.py",
      runCommand: async () => ({
        code: 2,
        stdout: "",
        stderr: [
          "requests\\packages\\urllib3\\_collections.py:7: in <module>",
          "    from collections import MutableMapping",
          "E   ImportError: cannot import name 'MutableMapping' from 'collections' (C:\\Python311\\Lib\\collections\\__init__.py)",
        ].join("\n"),
      }),
      recoveryController: recovery,
      executionEventBus: bus,
      emit() {},
      getRecoveryState: () => recovery.getRecoveryState(),
      verifier: { verify: async () => ({ verdict: "PASS", details: "unused", steps: [] }) },
      messages: [],
      runId: "old-python-verifier",
    },
  );
  assert.equal(outcome.kind, "pause");
  assert.match(outcome.kind === "pause" ? outcome.text : "", /^验证环境未就绪/);
  assert.match(outcome.kind === "pause" ? outcome.text : "", /MutableMapping/);
  assert.equal(events.some((event) => event.type === "verification_failed"), false);
});

test("a removed stdlib import in the changed file remains an implementation failure", async () => {
  const recovery = new RecoveryController({ sameFingerprintLimit: 2, strategyAttemptLimit: 4 });
  recovery.startRun({ runId: "changed-python-verifier", sessionId: "session", originalTask: "fix" });
  const outcome = await runWriteToolVerification(
    [{ call: { id: "write-changed-python", name: "write", arguments: { path: "requests/sessions.py" } } }],
    {
      verificationCommand: "python -m pytest -q test_requests.py",
      observations: [{ tool: "write", failed: false, mutation: "updated", mutationId: "m", changedPaths: ["requests/sessions.py"] }],
      runCommand: async () => ({
        code: 2,
        stdout: "",
        stderr: [
          '  File "C:\\repo\\requests\\sessions.py", line 10, in <module>',
          "ImportError: cannot import name 'MutableMapping' from 'collections'",
        ].join("\n"),
      }),
      recoveryController: recovery,
      executionEventBus: new ExecutionEventBus(),
      emit() {},
      getRecoveryState: () => recovery.getRecoveryState(),
      verifier: { verify: async () => ({ verdict: "PASS", details: "unused", steps: [] }) },
      messages: [],
      runId: "changed-python-verifier",
    },
  );
  assert.equal(outcome.kind, "recover");
});

test("environment incompatibility cannot bypass verifier workspace pollution", async () => {
  const { execFileSync } = await import("node:child_process");
  const workspaceDir = await mkdtemp(join(tmpdir(), "qling-environment-pollution-"));
  try {
    await writeFile(join(workspaceDir, "source.py"), "VALUE = 1\n");
    execFileSync("git", ["init", "-q"], { cwd: workspaceDir });
    execFileSync("git", ["config", "user.email", "eval@example.invalid"], { cwd: workspaceDir });
    execFileSync("git", ["config", "user.name", "Qling Eval"], { cwd: workspaceDir });
    execFileSync("git", ["add", "source.py"], { cwd: workspaceDir });
    execFileSync("git", ["commit", "-qm", "fixture"], { cwd: workspaceDir });
    await writeFile(join(workspaceDir, "source.py"), "VALUE = 2\n");
    const recovery = new RecoveryController();
    recovery.startRun({ runId: "polluting-verifier", sessionId: "session", originalTask: "fix" });
    let verifierRan = false;
    const outcome = await runWriteToolVerification(
      [{ call: { id: "write-source", name: "write", arguments: { path: "source.py" } } }],
      {
        verificationCommand: "python -m pytest",
        workspaceDir,
        observations: [{ tool: "write", failed: false, mutation: "updated", mutationId: "m", changedPaths: ["source.py"] }],
        runCommand: async (command) => {
          if (command === "python -m pytest") {
            verifierRan = true;
            await writeFile(join(workspaceDir, "generated.py"), "SIDE_EFFECT = True\n");
            return {
              code: 2,
              stdout: "",
              stderr: '  File "vendor/old.py", line 1, in <module>\nImportError: cannot import name \'MutableMapping\' from \'collections\'',
            };
          }
          return { code: 0, stdout: "", stderr: "" };
        },
        recoveryController: recovery,
        executionEventBus: new ExecutionEventBus(),
        emit() {},
        getRecoveryState: () => recovery.getRecoveryState(),
        verifier: { verify: async () => ({ verdict: "PASS", details: "unused", steps: [] }) },
        messages: [],
        runId: "polluting-verifier",
      },
    );
    assert.equal(verifierRan, true);
    assert.equal(outcome.kind, "recover");
    assert.equal(outcome.kind === "recover" ? outcome.strategy : "", "workspace_changed_during_verification");
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
  }
});

test("runWriteToolVerification uses the ProjectProfile targeted test after an indirect mutation", async () => {
  const workspaceDir = await mkdtemp(join(tmpdir(), "qling-project-verify-"));
  try {
    await writeFile(join(workspaceDir, "pyproject.toml"), "[tool.pytest.ini_options]\n");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(join(workspaceDir, "pkg", "tests"), { recursive: true }));
    await writeFile(join(workspaceDir, "pkg", "module.py"), "VALUE = 2\n");
    await writeFile(join(workspaceDir, "pkg", "tests", "test_module.py"), "def test_value(): pass\n");
    const { inspectProjectProfile } = await import("../../dist/runtime/project-profile.js");
    const profile = await inspectProjectProfile({ workspaceDir, requestedRuntime: "native" });
    const recovery = new RecoveryController();
    recovery.startRun({ runId: "project-verify", sessionId: "s", originalTask: "fix module" });
    const commands = [];
    const outcome = await runWriteToolVerification(
      [{ call: { id: "bash-1", name: "bash", arguments: { command: "python edit.py" } } }],
      {
        verificationCommand: null,
        projectProfile: profile,
        workspaceDir,
        observations: [{
          tool: "bash",
          failed: false,
          actionFingerprint: "bash:edit",
          mutation: "updated",
          mutationId: "bash:edit",
          changedPaths: ["pkg/module.py"],
        }],
        runCommand: async (command, runtime) => {
          commands.push({ command, runtime });
          return { code: 0, stdout: "1 passed", stderr: "" };
        },
        recoveryController: recovery,
        executionEventBus: new ExecutionEventBus(),
        emit() {},
        getRecoveryState: () => recovery.getRecoveryState(),
        verifier: { verify: async () => ({ verdict: "PASS", details: "ok", steps: [] }) },
        messages: [],
        runId: "project-verify",
      },
    );
    assert.equal(outcome.kind, "pass");
    assert.equal(commands.length, 0, "registered ProjectProfile commands use argv execution instead of a shell string");
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
  }
});
