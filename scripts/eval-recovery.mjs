import assert from "node:assert/strict";
import { classifyFailure } from "../dist/execution/failure-classifier.js";
import { RecoveryController } from "../dist/execution/recovery-controller.js";

const fixtures = [
  [Object.assign(new Error("rate limited"), { status: 429 }), "provider_transient"],
  [new Error("approval_required"), "permission_required"],
  [new Error("sandbox denied outside workspace"), "sandbox_denied"],
  [new Error("command not found"), "tool_not_found"],
  [new Error("maximum context length exhausted"), "context_exhausted"],
];

for (const [error, expected] of fixtures) {
  assert.equal(classifyFailure(error).category, expected);
}

const controller = new RecoveryController();
controller.startRun({ runId: "eval_run", sessionId: "eval_session", originalTask: "deterministic fixture" });
const failure = { category: "verification_failed", message: "tests failed", fingerprint: "same" };
assert.equal(controller.recordFailure(failure, { diffHash: "a", failingTests: ["one"] }).action, "recover");
assert.equal(controller.recordFailure(failure, { diffHash: "a", failingTests: ["one"] }).action, "pause");

console.log(JSON.stringify({ ok: true, fixtures: fixtures.length + 1, mode: "deterministic-no-model" }));
