import test from "node:test";
import assert from "node:assert/strict";

import {
  RunEfficiencyGuard,
  createInitialProgressState,
  reduceProgressState,
} from "../../dist/agent/run-efficiency.js";

test("efficiency recovery remains advisory and never removes task capabilities", () => {
  const guard = new RunEfficiencyGuard({ noProgressReplanLimit: 1, noProgressNarrowLimit: 2 });
  guard.recordProgress({ phase: "explore", kind: "no_progress", fingerprint: "one", value: 0 });
  guard.recordProgress({ phase: "explore", kind: "no_progress", fingerprint: "two", value: 0 });

  for (const tool of ["repo_map", "read", "search", "patch", "write", "bash", "verify"]) {
    assert.equal(guard.isToolAllowed(tool), true, `${tool} must not be hard-denied by efficiency policy`);
  }
  assert.ok(guard.getRecoveryEpisode()?.exitConditions.length > 0);
});

test("pure progress reducer closes the old episode on mutation and preserves a repair path", () => {
  const recovering = reduceProgressState(createInitialProgressState(), {
    type: "start_recovery",
    reason: "no_new_evidence",
    preferredCapabilities: ["repo_map", "repo_query"],
  });
  const mutated = reduceProgressState(recovering, {
    type: "mutation_succeeded",
    mutationId: "mutation:qdp",
  });

  assert.equal(mutated.phase, "verify");
  assert.equal(mutated.activeMutationId, "mutation:qdp");
  assert.notEqual(mutated.recoveryEpisode?.id, recovering.recoveryEpisode?.id);
  assert.ok(mutated.recoveryEpisode?.preferredCapabilities.includes("patch"));
  assert.ok(mutated.recoveryEpisode?.preferredCapabilities.includes("verify"));

  const failed = reduceProgressState(mutated, {
    type: "verification_finished",
    verifierId: "pytest:qdp",
    verdict: "fail",
    fingerprint: "read-terr-1",
  });
  assert.equal(failed.phase, "repair");
  assert.equal(failed.activeMutationId, "mutation:qdp");
  assert.ok(failed.recoveryEpisode?.preferredCapabilities.includes("write"));
  assert.ok(failed.recoveryEpisode?.exitConditions.length > 0);
});

test("a verifier failure can never transition directly to finalize", () => {
  const mutated = reduceProgressState(createInitialProgressState(), {
    type: "mutation_succeeded",
    mutationId: "mutation:a",
  });
  const failed = reduceProgressState(mutated, {
    type: "verification_finished",
    verifierId: "unit:a",
    verdict: "fail",
    fingerprint: "assertion:a",
  });
  const requested = reduceProgressState(failed, { type: "finalize_requested" });
  assert.equal(requested.phase, "repair");
});

