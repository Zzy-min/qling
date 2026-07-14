import assert from "node:assert/strict";
import { classifyFailure } from "../dist/execution/failure-classifier.js";
import { RecoveryController } from "../dist/execution/recovery-controller.js";
import { RecoveryStrategyPlanner } from "../dist/execution/recovery-strategy-planner.js";
import { calculateRecoveryMetrics } from "../dist/execution/recovery-metrics.js";

const fixtures = [
  [Object.assign(new Error("rate limited"), { status: 429 }), "provider_transient"],
  [new Error("approval_required"), "permission_required"],
  [new Error("sandbox denied outside workspace"), "sandbox_denied"],
  [new Error("command not found"), "tool_not_found"],
  [new Error("maximum context length exhausted"), "context_exhausted"],
  [new Error("permission denied"), "permission_denied"],
  [new Error("duplicate tool call repeated action"), "repeated_action"],
  [new Error("invalid tool arguments: missing required field"), "invalid_tool_arguments"],
  [new Error("verification command exited with code 1"), "verification_failed"],
];

for (const [error, expected] of fixtures) {
  assert.equal(classifyFailure(error).category, expected);
}

// Same fingerprint without progress -> pause
const controller = new RecoveryController();
controller.startRun({ runId: "eval_run", sessionId: "eval_session", originalTask: "deterministic fixture" });
const failure = { category: "verification_failed", message: "tests failed", fingerprint: "same" };
assert.equal(controller.recordFailure(failure, { diffHash: "a", failingTests: ["one"] }).action, "recover");
assert.equal(controller.recordFailure(failure, { diffHash: "a", failingTests: ["one"] }).action, "pause");

// Progress between same fingerprint failures still allows recover with next strategy
const improved = new RecoveryController();
improved.startRun({ runId: "eval_improved", sessionId: "eval_session", originalTask: "deterministic fixture" });
assert.equal(improved.recordFailure(
  { category: "verification_failed", message: "tests failed", fingerprint: "improved" },
  { diffHash: "a", failingTests: ["one", "two"] }
).recommendedStrategy, "targeted_verification_repair");
assert.equal(improved.recordFailure(
  { category: "verification_failed", message: "tests failed", fingerprint: "improved" },
  { diffHash: "b", failingTests: ["two"] }
).recommendedStrategy, "narrow_verification_scope");

// Hard-stop categories pause immediately
const stopped = new RecoveryController();
stopped.startRun({ runId: "eval_stopped", sessionId: "eval_session", originalTask: "deterministic fixture" });
assert.equal(stopped.recordFailure(
  { category: "sandbox_denied", message: "outside workspace", fingerprint: "sandbox" },
  {}
).action, "pause");
assert.equal(stopped.recordFailure(
  { category: "permission_required", message: "approval_required", fingerprint: "approval" },
  {}
).action, "pause");

// Context compaction strategy is single-use
const ctx = new RecoveryController();
ctx.startRun({ runId: "eval_ctx", sessionId: "eval_session", originalTask: "deterministic fixture" });
assert.equal(ctx.recordFailure(
  { category: "context_exhausted", message: "context exhausted", fingerprint: "ctx" },
  {}
).recommendedStrategy, "compact_context_once");
assert.equal(ctx.recordFailure(
  { category: "context_exhausted", message: "context exhausted", fingerprint: "ctx2" },
  { changed: true }
).reason, "no_recovery_strategy");

// User next strategy after pause
const planner = new RecoveryStrategyPlanner();
assert.deepEqual(planner.list("invalid_tool_arguments"), [
  "repair_tool_arguments",
  "return_tool_schema",
]);
const args = new RecoveryController({ planner });
args.startRun({ runId: "eval_args", sessionId: "eval_session", originalTask: "deterministic fixture" });
args.recordFailure(
  { category: "invalid_tool_arguments", message: "invalid arguments", fingerprint: "args" },
  {}
);
args.recordFailure(
  { category: "invalid_tool_arguments", message: "invalid arguments", fingerprint: "args" },
  {}
);
assert.equal(args.getRecoveryState().status, "paused");
assert.equal(args.applyAction("next").currentStrategy, "return_tool_schema");
assert.equal(args.applyAction("cancel").status, "canceled");

// Trajectory replay metrics from redacted JSONL-like events (no prompt/tool body)
const metrics = calculateRecoveryMetrics([
  { eventId: "e1", runId: "eval_improved", type: "attempt_completed", status: "failed", timestamp: 1 },
  { eventId: "e2", runId: "eval_improved", type: "recovery_started", status: "recovering", timestamp: 2, recoveryAction: "targeted_verification_repair" },
  { eventId: "e3", runId: "eval_improved", type: "attempt_completed", status: "succeeded", timestamp: 3 },
  { eventId: "e4", runId: "eval_improved", type: "run_completed", status: "succeeded", timestamp: 4 },
]);
assert.equal(metrics.finalSuccessRate, 1);
assert.ok(metrics.automaticRecoverySuccessRate >= 0);

console.log(JSON.stringify({
  ok: true,
  fixtures: fixtures.length + 6,
  metrics,
  mode: "deterministic-no-model",
}));
