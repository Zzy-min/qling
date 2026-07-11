import test from "node:test";
import assert from "node:assert/strict";

import { calculateRecoveryMetrics } from "../../dist/execution/recovery-metrics.js";

test("recovery metrics distinguish first attempt and recovered success", () => {
  const base = { eventId: "e", timestamp: 1 };
  const metrics = calculateRecoveryMetrics([
    { ...base, runId: "r1", type: "attempt_completed", status: "succeeded" },
    { ...base, runId: "r1", type: "run_completed", status: "succeeded" },
    { ...base, runId: "r2", type: "attempt_completed", status: "failed" },
    { ...base, runId: "r2", type: "failure", status: "recovering", fingerprint: "fp" },
    { ...base, runId: "r2", type: "recovery_started", status: "recovering", recoveryAction: "recover" },
    { ...base, runId: "r2", type: "attempt_completed", status: "succeeded" },
    { ...base, runId: "r2", type: "run_completed", status: "succeeded" },
  ]);
  assert.equal(metrics.runs, 2);
  assert.equal(metrics.firstAttemptSuccessRate, 0.5);
  assert.equal(metrics.finalSuccessRate, 1);
  assert.equal(metrics.automaticRecoverySuccessRate, 1);
});
