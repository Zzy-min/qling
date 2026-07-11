import test from "node:test";
import assert from "node:assert/strict";

import { ExecutionEventBus } from "../../dist/execution/event-bus.js";
import { classifyFailure, createFailureFingerprint } from "../../dist/execution/failure-classifier.js";
import { hasExecutionProgress } from "../../dist/execution/progress-detector.js";
import { RecoveryController } from "../../dist/execution/recovery-controller.js";

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
