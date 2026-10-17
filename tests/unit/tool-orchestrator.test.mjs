import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

import {
  buildToolSignature,
  parseToolArguments,
  prepareToolCalls,
  executePreparedTools,
  repairToolArguments,
  resolveToolEventTarget,
  stableStringify,
} from "../../dist/agent/tool-orchestrator.js";
import { ExecutionEventBus } from "../../dist/execution/event-bus.js";

test("parseToolArguments accepts object JSON and rejects arrays", () => {
  assert.deepEqual(parseToolArguments('{"path":"a.ts"}').value, { path: "a.ts" });
  assert.equal(parseToolArguments("[1,2]").ok, false);
});

test("tool event target follows workspace aliases without exposing absolute paths", () => {
  const workspace = path.join(os.tmpdir(), "qling-event-target");
  assert.equal(resolveToolEventTarget({ id: "t", name: "read", arguments: { path: "workspace_dir/SECRET.TXT" } }, workspace), "SECRET.TXT");
  assert.equal(resolveToolEventTarget({ id: "t", name: "read", arguments: { path: "../outside.txt" } }, workspace), "<outside-workspace>");
});

test("parseToolArguments repairs fenced and trailing-comma JSON with retries", () => {
  const fenced = parseToolArguments("```json\n{\"path\": \"x.ts\"}\n```", 1);
  assert.equal(fenced.ok, true);
  assert.equal(fenced.value.path, "x.ts");

  const trailing = parseToolArguments('{"path":"y.ts",}', 2);
  assert.equal(trailing.ok, true);
  assert.equal(trailing.value.path, "y.ts");
});

test("repairToolArguments strips fences on first attempt", () => {
  assert.equal(repairToolArguments("```json\n{\"a\":1}\n```", 0), '{"a":1}');
});

test("stableStringify is key-order independent for signatures", () => {
  const a = buildToolSignature("read", { b: 1, a: 2 });
  const b = buildToolSignature("read", { a: 2, b: 1 });
  assert.equal(a, b);
  assert.equal(stableStringify({ z: 1, a: 2 }), '{"a":2,"z":1}');
});

test("prepareToolCalls enforces per-signature repeat limit", () => {
  const raw = [
    {
      id: "1",
      type: "function",
      function: { name: "read", arguments: '{"path":"a.ts"}' },
    },
    {
      id: "2",
      type: "function",
      function: { name: "read", arguments: '{"path":"a.ts"}' },
    },
  ];
  const prepared = prepareToolCalls(raw, { toolRepeatLimit: 1, parseRetries: 0 });
  assert.equal(prepared.length, 2);
  assert.equal(prepared[0].immediateResult, undefined);
  assert.equal(prepared[1].immediateResult?.error?.code, "TOOL_REPEAT_LIMIT_EXCEEDED");
  assert.equal(prepared[1].loopDetected?.count, 2);
  assert.equal(prepared[1].loopDetected?.limit, 1);
});

test("prepareToolCalls marks invalid arguments immediately", () => {
  const prepared = prepareToolCalls(
    [
      {
        id: "bad",
        type: "function",
        function: { name: "read", arguments: "not-json" },
      },
    ],
    { parseRetries: 0 }
  );
  assert.equal(prepared[0].immediateResult?.error?.code, "TOOL_INVALID_ARGUMENTS");
});

test("executePreparedTools counts a pipeline is_error result exactly once", async () => {
  const messages = [];
  const bus = new ExecutionEventBus();
  const events = [];
  bus.subscribe((event) => events.push(event));
  const result = await executePreparedTools({
    pipeline: { execute: async () => ({ tool_call_id: "1", output: "forbidden", is_error: true }) },
    tools: [],
    guardConfig: { enabled: false },
    channel: null,
    approvalGate: {},
    knowledgeAdapter: { onToolCall() {}, onToolResult() {} },
    memoryStore: { link() {} },
    workspaceDir: process.cwd(),
    workflowRuntime: {},
    executionEventBus: bus,
    emit() {},
    reflectiveThink: async () => ({ decision: "proceed", reason: "" }),
  }, {
    preparedCalls: [{ call: { id: "1", name: "read", arguments: { path: "x" } } }],
    messages,
    runId: "run-1",
    attemptId: "attempt-1",
  });
  assert.equal(result.turnToolFailures, 1);
  assert.equal(result.observations.length, 1);
  assert.equal(result.observations[0].failed, true);
  assert.match(result.observations[0].failureFingerprint, /^read:/);
  assert.equal(events.filter((event) => event.type === "tool_completed").length, 1);
  assert.equal(events.find((event) => event.type === "tool_completed")?.status, "failed");
});

test("executePreparedTools preserves an efficiency redirect without counting a tool failure", async () => {
  const messages = [];
  const bus = new ExecutionEventBus();
  const events = [];
  bus.subscribe((event) => events.push(event));
  const result = await executePreparedTools({
    pipeline: { execute: async () => { throw new Error("redirected calls must not execute"); } },
    tools: [],
    guardConfig: { enabled: false },
    channel: null,
    approvalGate: {},
    knowledgeAdapter: { onToolCall() {}, onToolResult() {} },
    memoryStore: { link() {} },
    workspaceDir: process.cwd(),
    workflowRuntime: {},
    executionEventBus: bus,
    emit() {},
    reflectiveThink: async () => ({ decision: "proceed", reason: "" }),
  }, {
    preparedCalls: [{
      call: { id: "redirect-1", name: "bash", arguments: { command: "pytest" } },
      immediateResult: {
        tool_call_id: "redirect-1",
        output: "Error: [EFFICIENCY_RECOVERY_SCOPE] run targeted verification",
        is_error: true,
        error: {
          code: "EFFICIENCY_RECOVERY_SCOPE",
          message: "run targeted verification",
          category: "guard",
        },
      },
    }],
    messages,
    runId: "run-redirect",
    attemptId: "attempt-redirect",
  });

  assert.equal(result.turnToolCalls, 1);
  assert.equal(result.turnToolFailures, 0);
  assert.equal(result.observations.length, 1);
  assert.equal(result.observations[0].failed, false);
  assert.equal(result.observations[0].redirected, true);
  assert.equal(result.observations[0].failureFingerprint, undefined);
  assert.match(messages[0].content, /EFFICIENCY_RECOVERY_SCOPE/);
  assert.equal(events.find((event) => event.type === "tool_completed")?.status, "failed");
  assert.equal(events.find((event) => event.type === "tool_completed")?.policyRedirect, true);
});

test("executePreparedTools reports successful file mutations for the run ledger", async () => {
  const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "qling-efficiency-"));
  try {
    const result = await executePreparedTools({
      pipeline: {
        execute: async () => ({ tool_call_id: "write-1", output: "written", is_error: false }),
      },
      tools: [],
      guardConfig: { enabled: false },
      channel: null,
      approvalGate: {},
      knowledgeAdapter: { onToolCall() {}, onToolResult() {} },
      memoryStore: { link() {} },
      workspaceDir,
      workflowRuntime: {},
      executionEventBus: new ExecutionEventBus(),
      emit() {},
      reflectiveThink: async () => ({ decision: "proceed", reason: "" }),
    }, {
      preparedCalls: [{
        call: {
          id: "write-1",
          name: "write",
          arguments: { path: "created.txt", content: "hello" },
        },
      }],
      messages: [],
      runId: "run-write",
      attemptId: "attempt-write",
    });

    const actionFingerprint = `write:${createHash("sha256").update(JSON.stringify({ content: "hello", path: "created.txt" })).digest("hex")}`;
    assert.deepEqual(result.observations, [{
      tool: "write",
      failed: false,
      actionFingerprint,
      failureFingerprint: undefined,
      targetPath: path.join(workspaceDir, "created.txt"),
      changedPaths: ["created.txt"],
      mutation: "created",
      mutationId: actionFingerprint,
      workspaceFingerprint: result.observations[0].workspaceFingerprint,
    }]);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("executePreparedTools does not count isolated diagnostic writes as workspace mutations", async () => {
  const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "qling-diagnostic-observation-"));
  try {
    const result = await executePreparedTools({
      pipeline: { execute: async () => ({ tool_call_id: "write-diagnostic", output: "isolated", meta: { diagnosticArtifact: true, diagnosticPath: "state/diagnostics/_probe.py" } }) },
      tools: [], guardConfig: { enabled: false }, channel: null, approvalGate: {},
      knowledgeAdapter: { onToolCall() {}, onToolResult() {} }, memoryStore: { link() {} },
      workspaceDir, workflowRuntime: {}, executionEventBus: new ExecutionEventBus(), emit() {},
      reflectiveThink: async () => ({ decision: "proceed", reason: "" }),
    }, {
      preparedCalls: [{ call: { id: "write-diagnostic", name: "write", arguments: { path: "_probe.py", content: "print(1)" } } }],
      messages: [], runId: "run-diagnostic", attemptId: "attempt-diagnostic",
    });
    assert.equal(result.observations[0].mutation, undefined);
    assert.equal(result.observations[0].changedPaths, undefined);
    assert.equal(result.observations[0].targetPath, undefined);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("executePreparedTools does not count arbitrary-name patch updates to an untracked root environment probe", async () => {
  const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "qling-patch-diagnostic-observation-"));
  const previousReliability = process.env.QLING_FEATURES_RELIABILITY_V2;
  process.env.QLING_FEATURES_RELIABILITY_V2 = "true";
  try {
    execFileSync("git", ["init", "-q"], { cwd: workspaceDir });
    execFileSync("git", ["config", "user.email", "eval@example.invalid"], { cwd: workspaceDir });
    execFileSync("git", ["config", "user.name", "Qling Eval"], { cwd: workspaceDir });
    writeFileSync(path.join(workspaceDir, "source.py"), "VALUE = 1\n");
    execFileSync("git", ["add", "source.py"], { cwd: workspaceDir });
    execFileSync("git", ["commit", "-qm", "fixture"], { cwd: workspaceDir });
    writeFileSync(path.join(workspaceDir, "versions.py"), "import sys\nprint(sys.version)\n");
    const result = await executePreparedTools({
      pipeline: { execute: async () => {
        writeFileSync(path.join(workspaceDir, "versions.py"), "import sys\nprint(sys.version, 'after')\n");
        return { tool_call_id: "patch-diagnostic", output: "patched", is_error: false };
      } },
      tools: [], guardConfig: { enabled: false }, channel: null, approvalGate: {},
      knowledgeAdapter: { onToolCall() {}, onToolResult() {} }, memoryStore: { link() {} },
      workspaceDir, workflowRuntime: {}, executionEventBus: new ExecutionEventBus(), emit() {},
      reflectiveThink: async () => ({ decision: "proceed", reason: "" }),
    }, {
      preparedCalls: [{ call: { id: "patch-diagnostic", name: "patch", arguments: { path: "versions.py", chunks: [{ search: "before", replace: "after" }] } } }],
      messages: [{ role: "user", content: "fix source.py" }], runId: "run-patch-diagnostic", attemptId: "attempt-patch-diagnostic",
    });
    assert.equal(result.observations[0].mutation, undefined);
    assert.equal(result.observations[0].mutationId, undefined);
  } finally {
    if (previousReliability === undefined) delete process.env.QLING_FEATURES_RELIABILITY_V2;
    else process.env.QLING_FEATURES_RELIABILITY_V2 = previousReliability;
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("executePreparedTools detects workspace mutations made indirectly by bash", async () => {
  const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "qling-bash-mutation-"));
  const previousReliability = process.env.QLING_FEATURES_RELIABILITY_V2;
  process.env.QLING_FEATURES_RELIABILITY_V2 = "true";
  try {
    writeFileSync(path.join(workspaceDir, "source.py"), "VALUE = 1\n");
    execFileSync("git", ["init", "-q"], { cwd: workspaceDir });
    execFileSync("git", ["config", "user.email", "eval@example.invalid"], { cwd: workspaceDir });
    execFileSync("git", ["config", "user.name", "Qling Eval"], { cwd: workspaceDir });
    execFileSync("git", ["add", "source.py"], { cwd: workspaceDir });
    execFileSync("git", ["commit", "-qm", "fixture"], { cwd: workspaceDir });
    const result = await executePreparedTools({
      pipeline: {
        execute: async () => {
          writeFileSync(path.join(workspaceDir, "source.py"), "VALUE = 2\n");
          return { tool_call_id: "bash-1", output: "updated", is_error: false };
        },
      },
      tools: [],
      guardConfig: { enabled: false },
      channel: null,
      approvalGate: {},
      knowledgeAdapter: { onToolCall() {}, onToolResult() {} },
      memoryStore: { link() {}, addPractice() {} },
      workspaceDir,
      workflowRuntime: {},
      executionEventBus: new ExecutionEventBus(),
      emit() {},
      reflectiveThink: async () => ({ decision: "proceed", reason: "" }),
    }, {
      preparedCalls: [{ call: { id: "bash-1", name: "bash", arguments: { command: "python edit.py" } } }],
      messages: [{ role: "user", content: "update source.py" }],
      runId: "run-bash-mutation",
      attemptId: "attempt-bash-mutation",
    });
    assert.equal(result.observations[0].mutation, "updated");
    assert.deepEqual(result.observations[0].changedPaths, ["source.py"]);
    assert.match(result.observations[0].mutationId ?? "", /^bash:/);
  } finally {
    if (previousReliability === undefined) delete process.env.QLING_FEATURES_RELIABILITY_V2;
    else process.env.QLING_FEATURES_RELIABILITY_V2 = previousReliability;
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("executePreparedTools excludes root diagnostic files from indirect bash mutations", async () => {
  const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "qling-bash-diagnostic-"));
  const previousReliability = process.env.QLING_FEATURES_RELIABILITY_V2;
  process.env.QLING_FEATURES_RELIABILITY_V2 = "true";
  try {
    writeFileSync(path.join(workspaceDir, "source.py"), "VALUE = 1\n");
    execFileSync("git", ["init", "-q"], { cwd: workspaceDir });
    execFileSync("git", ["config", "user.email", "eval@example.invalid"], { cwd: workspaceDir });
    execFileSync("git", ["config", "user.name", "Qling Eval"], { cwd: workspaceDir });
    execFileSync("git", ["add", "source.py"], { cwd: workspaceDir });
    execFileSync("git", ["commit", "-qm", "fixture"], { cwd: workspaceDir });
    const result = await executePreparedTools({
      pipeline: {
        execute: async () => {
          writeFileSync(path.join(workspaceDir, "_tmp_regex_check.py"), "print('probe')\n");
          return { tool_call_id: "bash-diagnostic", output: "created diagnostic", is_error: false };
        },
      },
      tools: [], guardConfig: { enabled: false }, channel: null, approvalGate: {},
      knowledgeAdapter: { onToolCall() {}, onToolResult() {} }, memoryStore: { link() {} },
      workspaceDir, workflowRuntime: {}, executionEventBus: new ExecutionEventBus(), emit() {},
      reflectiveThink: async () => ({ decision: "proceed", reason: "" }),
    }, {
      preparedCalls: [{ call: { id: "bash-diagnostic", name: "bash", arguments: { command: "python create_probe.py" } } }],
      messages: [{ role: "user", content: "fix source.py" }],
      runId: "run-bash-diagnostic", attemptId: "attempt-bash-diagnostic",
    });
    assert.equal(result.observations[0].mutation, undefined);
    assert.equal(result.observations[0].mutationId, undefined);
    assert.equal(result.observations[0].changedPaths, undefined);
  } finally {
    if (previousReliability === undefined) delete process.env.QLING_FEATURES_RELIABILITY_V2;
    else process.env.QLING_FEATURES_RELIABILITY_V2 = previousReliability;
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("executePreparedTools counts an explicit Bash-created deliverable even when it resembles an environment probe", async () => {
  const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "qling-bash-explicit-deliverable-"));
  const previousReliability = process.env.QLING_FEATURES_RELIABILITY_V2;
  const previousDeliverables = process.env.QLING_DELIVERABLE_PATHS;
  process.env.QLING_FEATURES_RELIABILITY_V2 = "true";
  process.env.QLING_DELIVERABLE_PATHS = "versions.py";
  try {
    writeFileSync(path.join(workspaceDir, "source.py"), "VALUE = 1\n");
    execFileSync("git", ["init", "-q"], { cwd: workspaceDir });
    execFileSync("git", ["config", "user.email", "eval@example.invalid"], { cwd: workspaceDir });
    execFileSync("git", ["config", "user.name", "Qling Eval"], { cwd: workspaceDir });
    execFileSync("git", ["add", "source.py"], { cwd: workspaceDir });
    execFileSync("git", ["commit", "-qm", "fixture"], { cwd: workspaceDir });
    const result = await executePreparedTools({
      pipeline: { execute: async () => {
        writeFileSync(path.join(workspaceDir, "versions.py"), "import sys\nprint(sys.version)\n");
        return { tool_call_id: "bash-explicit", output: "created", is_error: false };
      } },
      tools: [], guardConfig: { enabled: false }, channel: null, approvalGate: {},
      knowledgeAdapter: { onToolCall() {}, onToolResult() {} }, memoryStore: { link() {} },
      workspaceDir, workflowRuntime: {}, executionEventBus: new ExecutionEventBus(), emit() {},
      reflectiveThink: async () => ({ decision: "proceed", reason: "" }),
    }, {
      preparedCalls: [{ call: { id: "bash-explicit", name: "bash", arguments: { command: "python make_versions.py" } } }],
      messages: [{ role: "user", content: "create versions.py" }], runId: "run-explicit", attemptId: "attempt-explicit",
    });
    assert.equal(result.observations[0].mutation, "created");
    assert.deepEqual(result.observations[0].changedPaths, ["versions.py"]);
  } finally {
    if (previousReliability === undefined) delete process.env.QLING_FEATURES_RELIABILITY_V2;
    else process.env.QLING_FEATURES_RELIABILITY_V2 = previousReliability;
    if (previousDeliverables === undefined) delete process.env.QLING_DELIVERABLE_PATHS;
    else process.env.QLING_DELIVERABLE_PATHS = previousDeliverables;
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("executePreparedTools recalculates mutation kind after filtering a created diagnostic", async () => {
  const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "qling-bash-mixed-diagnostic-"));
  const previousReliability = process.env.QLING_FEATURES_RELIABILITY_V2;
  process.env.QLING_FEATURES_RELIABILITY_V2 = "true";
  try {
    writeFileSync(path.join(workspaceDir, "source.py"), "VALUE = 1\n");
    execFileSync("git", ["init", "-q"], { cwd: workspaceDir });
    execFileSync("git", ["config", "user.email", "eval@example.invalid"], { cwd: workspaceDir });
    execFileSync("git", ["config", "user.name", "Qling Eval"], { cwd: workspaceDir });
    execFileSync("git", ["add", "source.py"], { cwd: workspaceDir });
    execFileSync("git", ["commit", "-qm", "fixture"], { cwd: workspaceDir });
    const result = await executePreparedTools({
      pipeline: { execute: async () => {
        writeFileSync(path.join(workspaceDir, "source.py"), "VALUE = 2\n");
        writeFileSync(path.join(workspaceDir, "_tmp_probe.py"), "print('probe')\n");
        return { tool_call_id: "bash-mixed", output: "updated", is_error: false };
      } },
      tools: [], guardConfig: { enabled: false }, channel: null, approvalGate: {},
      knowledgeAdapter: { onToolCall() {}, onToolResult() {} }, memoryStore: { link() {} },
      workspaceDir, workflowRuntime: {}, executionEventBus: new ExecutionEventBus(), emit() {},
      reflectiveThink: async () => ({ decision: "proceed", reason: "" }),
    }, {
      preparedCalls: [{ call: { id: "bash-mixed", name: "bash", arguments: { command: "python edit.py" } } }],
      messages: [{ role: "user", content: "fix source.py" }], runId: "run-mixed", attemptId: "attempt-mixed",
    });
    assert.equal(result.observations[0].mutation, "updated");
    assert.deepEqual(result.observations[0].changedPaths, ["source.py"]);
  } finally {
    if (previousReliability === undefined) delete process.env.QLING_FEATURES_RELIABILITY_V2;
    else process.env.QLING_FEATURES_RELIABILITY_V2 = previousReliability;
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("executePreparedTools records a bash mutation even when the command exits non-zero", async () => {
  const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "qling-bash-failed-mutation-"));
  const previousReliability = process.env.QLING_FEATURES_RELIABILITY_V2;
  process.env.QLING_FEATURES_RELIABILITY_V2 = "true";
  try {
    writeFileSync(path.join(workspaceDir, "source.py"), "VALUE = 1\n");
    execFileSync("git", ["init", "-q"], { cwd: workspaceDir });
    execFileSync("git", ["config", "user.email", "eval@example.invalid"], { cwd: workspaceDir });
    execFileSync("git", ["config", "user.name", "Qling Eval"], { cwd: workspaceDir });
    execFileSync("git", ["add", "source.py"], { cwd: workspaceDir });
    execFileSync("git", ["commit", "-qm", "fixture"], { cwd: workspaceDir });
    const result = await executePreparedTools({
      pipeline: { execute: async () => { writeFileSync(path.join(workspaceDir, "source.py"), "VALUE = 3\n"); return { tool_call_id: "bash-fail", output: "failed after write", is_error: true, error: { code: "BASH_EXIT_NON_ZERO", message: "exit 1", category: "runtime" } }; } },
      tools: [], guardConfig: { enabled: false }, channel: null, approvalGate: {}, knowledgeAdapter: { onToolCall() {}, onToolResult() {} }, memoryStore: { link() {} }, workspaceDir, workflowRuntime: {}, executionEventBus: new ExecutionEventBus(), emit() {}, reflectiveThink: async () => ({ decision: "proceed", reason: "" }),
    }, { preparedCalls: [{ call: { id: "bash-fail", name: "bash", arguments: { command: "write then exit 1" } } }], messages: [], runId: "run", attemptId: "attempt" });
    assert.equal(result.observations[0].failed, true);
    assert.equal(result.observations[0].mutation, "updated");
    assert.deepEqual(result.observations[0].changedPaths, ["source.py"]);
  } finally {
    if (previousReliability === undefined) delete process.env.QLING_FEATURES_RELIABILITY_V2; else process.env.QLING_FEATURES_RELIABILITY_V2 = previousReliability;
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("background bash mutation is reconciled when bg_wait completes", async () => {
  const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "qling-bg-mutation-"));
  const previousReliability = process.env.QLING_FEATURES_RELIABILITY_V2;
  process.env.QLING_FEATURES_RELIABILITY_V2 = "true";
  try {
    writeFileSync(path.join(workspaceDir, "source.py"), "VALUE = 1\n");
    execFileSync("git", ["init", "-q"], { cwd: workspaceDir });
    execFileSync("git", ["config", "user.email", "eval@example.invalid"], { cwd: workspaceDir });
    execFileSync("git", ["config", "user.name", "Qling Eval"], { cwd: workspaceDir });
    execFileSync("git", ["add", "source.py"], { cwd: workspaceDir });
    execFileSync("git", ["commit", "-qm", "fixture"], { cwd: workspaceDir });
    const deps = { tools: [], guardConfig: { enabled: false }, channel: null, approvalGate: {}, knowledgeAdapter: { onToolCall() {}, onToolResult() {} }, memoryStore: { link() {} }, workspaceDir, workflowRuntime: {}, executionEventBus: new ExecutionEventBus(), emit() {}, reflectiveThink: async () => ({ decision: "proceed", reason: "" }) };
    const started = await executePreparedTools({ ...deps, pipeline: { execute: async () => ({ tool_call_id: "bg-start", output: "started", meta: { backgroundTaskId: "bg_fixture" } }) } }, { preparedCalls: [{ call: { id: "bg-start", name: "bash", arguments: { command: "later", background: true } } }], messages: [], runId: "run", attemptId: "a1" });
    assert.equal(started.observations[0].backgroundTaskStarted, "bg_fixture");
    const waited = await executePreparedTools({ ...deps, pipeline: { execute: async () => { writeFileSync(path.join(workspaceDir, "source.py"), "VALUE = 4\n"); return { tool_call_id: "bg-wait", output: "completed", meta: { backgroundTaskCompleted: "bg_fixture" } }; } } }, { preparedCalls: [{ call: { id: "bg-wait", name: "bg_wait", arguments: { task_id: "bg_fixture" } } }], messages: [], runId: "run", attemptId: "a2" });
    assert.equal(waited.observations[0].backgroundTaskCompleted, "bg_fixture");
    assert.equal(waited.observations[0].mutation, "updated");
    assert.deepEqual(waited.observations[0].changedPaths, ["source.py"]);
  } finally {
    if (previousReliability === undefined) delete process.env.QLING_FEATURES_RELIABILITY_V2; else process.env.QLING_FEATURES_RELIABILITY_V2 = previousReliability;
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("bg_kill completes the pending side effect and reconciles its workspace baseline", async () => {
  const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "qling-bg-kill-"));
  const previousReliability = process.env.QLING_FEATURES_RELIABILITY_V2;
  process.env.QLING_FEATURES_RELIABILITY_V2 = "true";
  try {
    writeFileSync(path.join(workspaceDir, "source.py"), "VALUE = 1\n");
    execFileSync("git", ["init", "-q"], { cwd: workspaceDir });
    execFileSync("git", ["config", "user.email", "eval@example.invalid"], { cwd: workspaceDir });
    execFileSync("git", ["config", "user.name", "Qling Eval"], { cwd: workspaceDir });
    execFileSync("git", ["add", "source.py"], { cwd: workspaceDir });
    execFileSync("git", ["commit", "-qm", "fixture"], { cwd: workspaceDir });
    const deps = { tools: [], guardConfig: { enabled: false }, channel: null, approvalGate: {}, knowledgeAdapter: { onToolCall() {}, onToolResult() {} }, memoryStore: { link() {} }, workspaceDir, workflowRuntime: {}, executionEventBus: new ExecutionEventBus(), emit() {}, reflectiveThink: async () => ({ decision: "proceed", reason: "" }) };
    const started = await executePreparedTools({ ...deps, pipeline: { execute: async () => ({ tool_call_id: "bg-start-kill", output: "started", meta: { backgroundTaskId: "bg_kill_fixture" } }) } }, { preparedCalls: [{ call: { id: "bg-start-kill", name: "bash", arguments: { command: "later", background: true } } }], messages: [], runId: "run", attemptId: "a1" });
    assert.equal(started.observations[0].backgroundTaskStarted, "bg_kill_fixture");
    const killed = await executePreparedTools({ ...deps, pipeline: { execute: async () => { writeFileSync(path.join(workspaceDir, "source.py"), "VALUE = 5\n"); return { tool_call_id: "bg-kill", output: "killed", meta: { backgroundTaskCompleted: "bg_kill_fixture" } }; } } }, { preparedCalls: [{ call: { id: "bg-kill", name: "bg_kill", arguments: { task_id: "bg_kill_fixture" } } }], messages: [], runId: "run", attemptId: "a2" });
    assert.equal(killed.observations[0].backgroundTaskCompleted, "bg_kill_fixture");
    assert.equal(killed.observations[0].mutation, "updated");
    assert.deepEqual(killed.observations[0].changedPaths, ["source.py"]);
  } finally {
    if (previousReliability === undefined) delete process.env.QLING_FEATURES_RELIABILITY_V2; else process.env.QLING_FEATURES_RELIABILITY_V2 = previousReliability;
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("bg_reconcile preserves an unknown side effect as a mutation requiring verification", async () => {
  const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "qling-bg-reconcile-ledger-"));
  const previousReliability = process.env.QLING_FEATURES_RELIABILITY_V2;
  const previousTrustBoundary = process.env.QLING_FEATURES_TRUST_BOUNDARY;
  process.env.QLING_FEATURES_RELIABILITY_V2 = "true";
  process.env.QLING_FEATURES_TRUST_BOUNDARY = "true";
  try {
    writeFileSync(path.join(workspaceDir, "source.py"), "VALUE = 1\n");
    execFileSync("git", ["init", "-q"], { cwd: workspaceDir });
    execFileSync("git", ["config", "user.email", "eval@example.invalid"], { cwd: workspaceDir });
    execFileSync("git", ["config", "user.name", "Qling Eval"], { cwd: workspaceDir });
    execFileSync("git", ["add", "source.py"], { cwd: workspaceDir });
    execFileSync("git", ["commit", "-qm", "fixture"], { cwd: workspaceDir });
    const deps = { tools: [], guardConfig: { enabled: false }, channel: null, approvalGate: {}, knowledgeAdapter: { onToolCall() {}, onToolResult() {} }, memoryStore: { link() {} }, workspaceDir, workflowRuntime: {}, executionEventBus: new ExecutionEventBus(), emit() {}, reflectiveThink: async () => ({ decision: "proceed", reason: "" }) };
    const result = await executePreparedTools(
      { ...deps, pipeline: { execute: async () => ({ tool_call_id: "reconcile", output: "reconciliation pending", meta: { backgroundTaskReconciliationPending: "bg_unknown" } }) } },
      { preparedCalls: [{ call: { id: "reconcile", name: "bg_reconcile", arguments: { task_id: "bg_unknown", confirm_unknown_outcome: true } } }], messages: [{ role: "user", content: "只读分析这个仓库" }], runId: "run", attemptId: "a1" },
    );
    assert.equal(result.observations[0].backgroundTaskReconciled, "bg_unknown");
    assert.equal(result.observations[0].mutation, "updated");
    assert.deepEqual(result.observations[0].changedPaths, ["<unknown-background-outcome>"]);
    assert.ok(result.observations[0].workspaceFingerprint);
  } finally {
    if (previousReliability === undefined) delete process.env.QLING_FEATURES_RELIABILITY_V2;
    else process.env.QLING_FEATURES_RELIABILITY_V2 = previousReliability;
    if (previousTrustBoundary === undefined) delete process.env.QLING_FEATURES_TRUST_BOUNDARY;
    else process.env.QLING_FEATURES_TRUST_BOUNDARY = previousTrustBoundary;
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});
