import test from "node:test";
import assert from "node:assert/strict";

import { ExecutionEventBus } from "../../dist/execution/event-bus.js";
import { classifyFailure, createFailureFingerprint } from "../../dist/execution/failure-classifier.js";
import { hasExecutionProgress } from "../../dist/execution/progress-detector.js";
import { RecoveryController } from "../../dist/execution/recovery-controller.js";
import { RecoveryStrategyPlanner } from "../../dist/execution/recovery-strategy-planner.js";

test("execution event bus emits one terminal event per run", () => {
  const bus = new ExecutionEventBus({ now: () => 100 });
  const events = [];
  bus.subscribe((event) => events.push(event));

  bus.startRun({ runId: "run_1", sessionId: "session_1" });
  bus.completeRun("run_1", "succeeded");
  bus.completeRun("run_1", "failed");

  assert.equal(events.filter((event) => event.type === "run_started").length, 1);
  assert.equal(events.filter((event) => event.type === "run_completed").length, 1);
  assert.equal(events.at(-1).status, "succeeded");
});

test("execution event bus closes attempt and tool items exactly once", () => {
  const bus = new ExecutionEventBus({ now: () => 100 });
  const events = [];
  bus.subscribe((event) => events.push(event));
  bus.startRun({ runId: "run_items", sessionId: "session_1" });
  bus.startAttempt({ runId: "run_items", sessionId: "session_1", attemptId: "attempt_1" });
  bus.startTool({ runId: "run_items", attemptId: "attempt_1", toolCallId: "tool_1", tool: "bash" });
  bus.completeTool({ runId: "run_items", attemptId: "attempt_1", toolCallId: "tool_1", tool: "bash" });
  bus.completeTool({ runId: "run_items", attemptId: "attempt_1", toolCallId: "tool_1", tool: "bash", failed: true });
  bus.completeAttempt("run_items", "succeeded");
  bus.completeAttempt("run_items", "failed");

  assert.equal(events.filter((event) => event.type === "tool_completed").length, 1);
  assert.equal(events.filter((event) => event.type === "attempt_completed").length, 1);
  assert.ok(events.every((event) => event.sessionId === "session_1"));
});

test("failure classifier distinguishes permission, verification and transient provider errors", () => {
  assert.equal(classifyFailure(new Error("approval_required")).category, "permission_required");
  assert.equal(classifyFailure(new Error("verification command exited with code 1")).category, "verification_failed");
  assert.equal(classifyFailure(Object.assign(new Error("rate limited"), { status: 429 })).category, "provider_transient");
});

test("failure fingerprint ignores paths timestamps and changing numeric noise", () => {
  const first = createFailureFingerprint({
    category: "tool_execution",
    tool: "bash",
    message: "C:\\tmp\\repo-a\\src\\a.ts failed at 2026-07-12 10:22:11 exit 1",
    targetPath: "C:\\tmp\\repo-a\\src\\a.ts",
  });
  const second = createFailureFingerprint({
    category: "tool_execution",
    tool: "bash",
    message: "D:\\work\\repo-b\\src\\a.ts failed at 2026-07-13 11:33:44 exit 2",
    targetPath: "D:\\work\\repo-b\\src\\a.ts",
  });
  assert.equal(first, second);
});

test("progress detector requires diff tests or todo evidence to change", () => {
  const before = { diffHash: "a", failingTests: ["one", "two"], completedTodos: 1 };
  assert.equal(hasExecutionProgress(before, { ...before }), false);
  assert.equal(hasExecutionProgress(before, { ...before, diffHash: "b" }), true);
  assert.equal(hasExecutionProgress(before, { ...before, failingTests: ["two"] }), true);
  assert.equal(hasExecutionProgress(before, { ...before, completedTodos: 2 }), true);
  assert.equal(
    hasExecutionProgress(before, { ...before, changedFiles: ["a.ts"] }),
    true
  );
});

test("recovery controller pauses after two identical no-progress failures", () => {
  const controller = new RecoveryController({ sameFingerprintLimit: 2, strategyAttemptLimit: 4 });
  controller.startRun({ runId: "run_same", sessionId: "session_1", originalTask: "fix" });
  const failure = { category: "tool_execution", tool: "bash", message: "build failed", fingerprint: "same" };
  const progress = { diffHash: "a", failingTests: ["build"], completedTodos: 0 };

  assert.equal(controller.recordFailure(failure, progress).action, "recover");
  const stopped = controller.recordFailure(failure, progress);
  assert.equal(stopped.action, "pause");
  assert.equal(stopped.category, "no_progress");
  assert.equal(controller.getRecoveryState().remainingStrategyAttempts, 2);
});

test("recovery controller enforces four total strategy attempts", () => {
  const controller = new RecoveryController({ sameFingerprintLimit: 2, strategyAttemptLimit: 4 });
  controller.startRun({ runId: "run_budget", sessionId: "session_1", originalTask: "fix" });
  for (let index = 0; index < 3; index++) {
    const decision = controller.recordFailure(
      { category: "tool_execution", message: `failure ${index}`, fingerprint: `fp_${index}` },
      { diffHash: String(index), failingTests: [`t${index}`], completedTodos: index }
    );
    assert.equal(decision.action, "recover");
  }
  const fourth = controller.recordFailure(
    { category: "tool_execution", message: "failure 4", fingerprint: "fp_4" },
    { diffHash: "4", failingTests: ["t4"], completedTodos: 4 }
  );
  assert.equal(fourth.action, "pause");
  assert.equal(fourth.reason, "strategy_budget_exhausted");
});

test("recovery strategy planner selects deterministic category-specific strategies", () => {
  const planner = new RecoveryStrategyPlanner();

  assert.deepEqual(planner.list("invalid_tool_arguments"), [
    "repair_tool_arguments",
    "return_tool_schema",
  ]);
  assert.deepEqual(planner.list("verification_failed"), [
    "targeted_verification_repair",
    "narrow_verification_scope",
  ]);
  assert.deepEqual(planner.list("context_exhausted"), ["compact_context_once"]);
  assert.deepEqual(planner.list("permission_denied"), []);
  assert.deepEqual(planner.list("sandbox_denied"), []);
  assert.deepEqual(planner.list("repeated_action"), []);
});

test("recovery controller exposes current strategy and next selects a different strategy", () => {
  const controller = new RecoveryController();
  controller.startRun({ runId: "run_strategy", sessionId: "session_1", originalTask: "fix" });
  const decision = controller.recordFailure(
    { category: "verification_failed", message: "tests failed", fingerprint: "verify_1" },
    { diffHash: "a", failingTests: ["one"] }
  );

  assert.equal(decision.recommendedStrategy, "targeted_verification_repair");
  assert.equal(controller.getRecoveryState().currentStrategy, "targeted_verification_repair");
  assert.deepEqual(controller.getRecoveryState().attemptedStrategies, ["targeted_verification_repair"]);

  // Force pause so user actions are allowed
  const paused = controller.recordFailure(
    { category: "verification_failed", message: "tests failed", fingerprint: "verify_1" },
    { diffHash: "a", failingTests: ["one"] }
  );
  assert.equal(paused.action, "pause");
  assert.equal(controller.getRecoveryState().status, "paused");

  const next = controller.applyAction("next");
  assert.equal(next.currentStrategy, "narrow_verification_scope");
  assert.deepEqual(next.attemptedStrategies, [
    "targeted_verification_repair",
    "narrow_verification_scope",
  ]);
});

test("recovery retry preserves strategy while edit and cancel terminate recovery state", () => {
  const controller = new RecoveryController();
  controller.startRun({ runId: "run_actions", sessionId: "session_1", originalTask: "fix" });
  // hard-stop category -> paused with no strategy
  controller.recordFailure(
    { category: "permission_denied", message: "permission denied", fingerprint: "perm_1" },
    {}
  );
  assert.equal(controller.getRecoveryState().status, "paused");

  // tool_not_found path: recover once then force pause via same fingerprint
  const tools = new RecoveryController();
  tools.startRun({ runId: "run_tools", sessionId: "session_1", originalTask: "fix" });
  tools.recordFailure(
    { category: "tool_not_found", message: "command not found", fingerprint: "missing_1" },
    {}
  );
  tools.recordFailure(
    { category: "tool_not_found", message: "command not found", fingerprint: "missing_1" },
    {}
  );
  assert.equal(tools.getRecoveryState().status, "paused");
  assert.equal(tools.getRecoveryState().currentStrategy, "inspect_command_environment");

  const retry = tools.applyAction("retry");
  assert.equal(retry.currentStrategy, "inspect_command_environment");
  assert.equal(retry.status, "recovering");

  // cancel allowed even when not paused
  const second = new RecoveryController();
  second.startRun({ runId: "run_cancel", sessionId: "session_1", originalTask: "fix" });
  assert.equal(second.applyAction("cancel").status, "canceled");

  // edit only from paused
  const editCtl = new RecoveryController();
  editCtl.startRun({ runId: "run_edit", sessionId: "session_1", originalTask: "fix original" });
  editCtl.recordFailure(
    { category: "sandbox_denied", message: "outside workspace", fingerprint: "sbx" },
    {}
  );
  const edit = editCtl.applyAction("edit");
  assert.equal(edit.status, "canceled");
  assert.equal(edit.originalTask, "fix original");
});

test("context exhaustion offers compaction only once then pauses", () => {
  const controller = new RecoveryController();
  controller.startRun({ runId: "run_context", sessionId: "session_1", originalTask: "fix" });
  const failure = { category: "context_exhausted", message: "context exhausted", fingerprint: "ctx" };

  assert.equal(controller.recordFailure(failure, {}).recommendedStrategy, "compact_context_once");
  const stopped = controller.recordFailure(failure, { changed: true });
  assert.equal(stopped.action, "pause");
  assert.equal(stopped.reason, "no_recovery_strategy");
});

test("recovery actions require paused state except cancel", () => {
  const controller = new RecoveryController();
  controller.startRun({ runId: "run_precond", sessionId: "session_1", originalTask: "fix" });
  assert.throws(() => controller.applyAction("retry"), /no active paused recovery task/);
  assert.throws(() => controller.applyAction("next"), /no active paused recovery task/);
  assert.throws(() => controller.applyAction("edit"), /no active paused recovery task/);
  assert.equal(controller.applyAction("cancel").status, "canceled");
});

test("invalid args strategies advance on next after pause", () => {
  const controller = new RecoveryController();
  controller.startRun({ runId: "run_args", sessionId: "session_1", originalTask: "fix" });
  const first = controller.recordFailure(
    { category: "invalid_tool_arguments", message: "invalid arguments", fingerprint: "args_1" },
    {}
  );
  assert.equal(first.recommendedStrategy, "repair_tool_arguments");
  // second same fingerprint pauses
  assert.equal(
    controller.recordFailure(
      { category: "invalid_tool_arguments", message: "invalid arguments", fingerprint: "args_1" },
      {}
    ).action,
    "pause"
  );
  const next = controller.applyAction("next");
  assert.equal(next.currentStrategy, "return_tool_schema");
});
