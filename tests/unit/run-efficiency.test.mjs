import test from "node:test";
import assert from "node:assert/strict";

import {
  RunEfficiencyGuard,
  classifyToolProgressKind,
  normalizeEvidenceOutput,
  normalizeFailureFingerprint,
} from "../../dist/agent/run-efficiency.js";
import { buildMandatoryRulesReference } from "../../dist/agent/system-prompt.js";

test("failure fingerprints keep diagnostic causes while ignoring volatile paths and numbers", () => {
  const first = normalizeFailureFingerprint({
    tool: "bash",
    code: "TOOL_ERROR",
    category: "runtime",
    message: "exit code: 1\nstderr: SyntaxError: unterminated string literal at C:\\Users\\Lenovo\\probe1.ps1:10",
  });
  const second = normalizeFailureFingerprint({
    tool: "bash",
    code: "TOOL_ERROR",
    category: "runtime",
    message: "exit code: 2\nstderr: FINDSTR cannot open file at C:\\Users\\Lenovo\\probe2.ps1:20",
  });
  assert.notEqual(first, second);
});

test("efficiency guard does not merge changed actions that happen to share an error family", () => {
  const guard = new RunEfficiencyGuard();
  assert.equal(
    guard.recordTools([
      { tool: "bash", failed: true, actionFingerprint: "bash:probe-1", failureFingerprint: "bash:runtime:command-failed" },
    ]),
    null
  );
  assert.equal(
    guard.recordTools([
      { tool: "bash", failed: true, actionFingerprint: "bash:probe-2", failureFingerprint: "bash:runtime:command-failed" },
    ]),
    null
  );
});

test("efficiency guard redirects an unchanged failing action instead of stopping the task", () => {
  const guard = new RunEfficiencyGuard();
  const observation = {
    tool: "bash",
    failed: true,
    actionFingerprint: "bash:same-command",
    failureFingerprint: "bash:runtime:syntax-error",
  };
  assert.equal(guard.recordTools([observation]), null);
  const signal = guard.recordTools([observation]);
  assert.equal(signal?.disposition, "redirect");
  assert.match(signal?.reason ?? "", /更换参数、工具或策略/);
});

test("the first malformed patch recommends anchored editing without denying other tools", () => {
  const guard = new RunEfficiencyGuard();
  const signal = guard.recordTools([{
    tool: "patch",
    failed: true,
    actionFingerprint: "patch:invalid-json",
    failureFingerprint: "patch:runtime:tool_invalid_arguments",
    failureCode: "TOOL_INVALID_ARGUMENTS",
  }]);
  assert.equal(signal?.directive.action, "correct_parameters");
  assert.deepEqual(
    signal?.directive.action === "correct_parameters" ? signal.directive.suggestedTools : [],
    ["read_anchored", "patch_anchored"],
  );
  assert.match(signal?.reason ?? "", /anchored/i);
  assert.equal(guard.isToolAllowed("patch"), true);
  assert.equal(guard.isToolAllowed("write"), true);
  assert.equal(guard.isToolAllowed("bash"), true);
});

test("repeating the identical malformed patch escalates without a hard policy denial", () => {
  const guard = new RunEfficiencyGuard();
  const observation = {
    tool: "patch",
    failed: true,
    actionFingerprint: "patch:invalid-json",
    failureFingerprint: "patch:runtime:tool_invalid_arguments",
    failureCode: "TOOL_INVALID_ARGUMENTS",
  };

  const first = guard.recordTools([observation]);
  assert.equal(first?.directive.action, "correct_parameters");
  assert.deepEqual(
    first?.directive.action === "correct_parameters" ? first.directive.suggestedTools : [],
    ["read_anchored", "patch_anchored"],
  );
  const repeated = guard.recordTools([observation]);
  assert.equal(repeated?.directive.action, "correct_parameters");
  assert.deepEqual(
    repeated?.directive.action === "correct_parameters" ? repeated.directive.suggestedTools : undefined,
    undefined,
  );
  assert.equal(guard.isActionBlocked(observation.actionFingerprint), false);
  assert.equal(guard.isToolAllowed("patch"), true);
  assert.equal(guard.isToolAllowed("write"), true);
});

test("14365 malformed patch replay reaches anchored mutation and verification", () => {
  const guard = new RunEfficiencyGuard();
  const recovery = guard.recordTools([{
    tool: "patch",
    failed: true,
    actionFingerprint: "patch:14365:malformed",
    failureFingerprint: "patch:runtime:tool_invalid_arguments",
    failureCode: "TOOL_INVALID_ARGUMENTS",
  }]);

  assert.deepEqual(
    recovery?.directive.action === "correct_parameters" ? recovery.directive.suggestedTools : [],
    ["read_anchored", "patch_anchored"],
  );
  const mutation = guard.recordTools([{
    tool: "patch_anchored",
    failed: false,
    actionFingerprint: "patch_anchored:14365:qdp-case",
    changedPaths: ["astropy/io/ascii/qdp.py"],
    mutation: "updated",
    mutationId: "mutation:14365:qdp-case",
    workspaceFingerprint: "workspace:14365:mutated",
  }]);
  assert.equal(mutation?.directive.action, "verify_or_finish");
  assert.equal(guard.getPhase(), "verify");

  const verified = guard.recordObservationProgress([{
    tool: "verify",
    failed: false,
    progressKind: "verification_delta",
    evidenceFingerprint: "verify:14365:pass",
    verifierId: "pytest:qdp",
    mutationId: "mutation:14365:qdp-case",
    verificationBaseFingerprint: "workspace:14365:mutated",
    workspaceFingerprint: "workspace:14365:mutated",
    verificationVerdict: "pass",
  }]);
  assert.equal(verified?.directive.action, "verify_or_finish");
  assert.equal(guard.getPhase(), "finalize");
});

test("progress guard escalates without converting efficiency signals into hard stops", () => {
  const guard = new RunEfficiencyGuard({ sameFailureLimit: 2, noProgressReplanLimit: 4, noProgressNarrowLimit: 8 });
  const failure = { tool: "bash", failed: true, actionFingerprint: "bash:same", failureFingerprint: "syntax" };
  assert.equal(guard.recordTools([failure]), null);
  const correction = guard.recordTools([failure]);
  assert.equal(correction?.directive.action, "correct_parameters");
  assert.equal(correction?.disposition, "redirect");

  let replan;
  for (let index = 0; index < 4; index++) {
    replan = guard.recordProgress({ kind: "no_progress", fingerprint: `np-${index}`, value: 0 }) ?? replan;
  }
  assert.equal(replan?.directive.action, "replan_repository");

  let narrowed;
  for (let index = 4; index < 8; index++) {
    narrowed = guard.recordProgress({ kind: "no_progress", fingerprint: `np-${index}`, value: 0 }) ?? narrowed;
  }
  assert.equal(narrowed?.directive.action, "narrow_recovery");
  assert.equal(narrowed?.disposition, "redirect");
});

test("causal repository evidence resets no-progress escalation before recovery", () => {
  const guard = new RunEfficiencyGuard({ noProgressReplanLimit: 2, noProgressNarrowLimit: 4 });
  guard.recordProgress({ phase: "explore", kind: "no_progress", fingerprint: "one", value: 0 });
  guard.recordProgress({ phase: "explore", kind: "causal_repository_evidence", fingerprint: "symbol-found", value: 1 });
  assert.equal(guard.recordProgress({ phase: "explore", kind: "no_progress", fingerprint: "two", value: 0 }), null);
});

test("repeated evidence fingerprints count as no progress", () => {
  const guard = new RunEfficiencyGuard({ noProgressReplanLimit: 2, noProgressNarrowLimit: 4 });
  assert.equal(
    guard.recordObservationProgress([{ tool: "read", failed: false, actionFingerprint: "read:a:1-100" }]),
    null
  );
  const signal = guard.recordObservationProgress([
    { tool: "read", failed: false, actionFingerprint: "read:a:1-100" },
  ]);
  assert.equal(signal?.directive.action, "replan_repository");
});

test("unique successful bash commands do not manufacture progress without evidence", () => {
  const guard = new RunEfficiencyGuard({ noProgressReplanLimit: 3, noProgressNarrowLimit: 5 });
  let signal = null;
  for (let index = 0; index < 3; index++) {
    signal = guard.recordObservationProgress([
      { tool: "bash", failed: false, actionFingerprint: `bash:unique-${index}` },
    ]) ?? signal;
  }
  assert.equal(signal?.directive.action, "replan_repository");
});

test("bash progress classification distinguishes verification from arbitrary shell work", () => {
  assert.equal(classifyToolProgressKind("bash", { command: "python -m pytest tests/unit" }), "verification_delta");
  assert.equal(classifyToolProgressKind("bash", { command: "git diff --check" }), undefined);
  assert.equal(classifyToolProgressKind("bash", { command: "rg TODO src" }), undefined);
  assert.equal(classifyToolProgressKind("repo_query", { query: "parser failure" }), "causal_repository_evidence");
  assert.equal(classifyToolProgressKind("bash", { command: "python scripts/ad_hoc_probe.py" }), undefined);
  assert.equal(classifyToolProgressKind("verify", { commandId: "project:python:pytest" }), "verification_delta");
});

test("git diff after a mutation cannot masquerade as deterministic verification", () => {
  const guard = new RunEfficiencyGuard();
  guard.recordTools([{
    tool: "patch",
    failed: false,
    actionFingerprint: "patch:qdp",
    targetPath: "astropy/io/ascii/qdp.py",
    mutation: "updated",
    mutationId: "mutation:qdp",
  }]);
  assert.equal(guard.recordObservationProgress([{
    tool: "bash",
    failed: false,
    actionFingerprint: "bash:git-diff",
    evidenceFingerprint: "git-diff:clean-shape",
  }]), null);
  assert.equal(guard.getPhase(), "verify");
  assert.equal(guard.isToolAllowed("search"), true);
});

test("evidence normalization removes volatile timing without hiding the verdict", () => {
  assert.equal(
    normalizeEvidenceOutput("FAILED test_a in 123.4ms at 2026-08-05T10:11:12Z"),
    normalizeEvidenceOutput("FAILED test_a in 987.6ms at 2026-08-05T10:12:59Z")
  );
  assert.equal(
    normalizeEvidenceOutput("duration_ms: 0.9521\nPASS test_a"),
    normalizeEvidenceOutput("duration_ms: 41.773\nPASS test_a")
  );
  assert.notEqual(normalizeEvidenceOutput("FAILED test_a"), normalizeEvidenceOutput("PASSED test_a"));
});

test("bash verification progress is keyed by observed evidence rather than command spelling", () => {
  const guard = new RunEfficiencyGuard({ noProgressReplanLimit: 2, noProgressNarrowLimit: 4 });
  assert.equal(guard.recordObservationProgress([{
    tool: "bash",
    failed: false,
    actionFingerprint: "bash:npm-test",
    progressKind: "verification_delta",
    evidenceFingerprint: "verification:same-result",
  }]), null);
  assert.equal(guard.recordObservationProgress([{
    tool: "bash",
    failed: false,
    actionFingerprint: "bash:npm-test-again",
    progressKind: "verification_delta",
    evidenceFingerprint: "verification:same-result",
  }]), null);
  const signal = guard.recordObservationProgress([{
    tool: "bash",
    failed: false,
    actionFingerprint: "bash:npm-test-third-spelling",
    progressKind: "verification_delta",
    evidenceFingerprint: "verification:same-result",
  }]);
  assert.equal(signal?.directive.action, "replan_repository");
});

test("narrow recovery advice is not cleared by an unrelated read", () => {
  const guard = new RunEfficiencyGuard({ noProgressReplanLimit: 1, noProgressNarrowLimit: 2 });
  guard.recordProgress({ phase: "explore", kind: "no_progress", fingerprint: "one", value: 0 });
  const narrowed = guard.recordProgress({ phase: "explore", kind: "no_progress", fingerprint: "two", value: 0 });
  assert.equal(narrowed?.directive.action, "narrow_recovery");
  assert.equal(guard.isToolAllowed("write"), true);
  assert.equal(guard.isToolAllowed("repo_query"), true);
  assert.equal(guard.isToolAllowed("bash", { command: "python ad_hoc_probe.py" }), true);
  assert.equal(guard.isToolAllowed("bash", { command: "python -m pytest tests/unit" }), true);
  assert.equal(guard.isToolAllowed("bash", { command: "python ad_hoc_probe.py; npm test" }), true);
  assert.equal(guard.isToolAllowed("bash", { command: "python ad_hoc_probe.py npm test" }), true);
  assert.equal(
    guard.isToolAllowed("bash", { command: "python -m pytest tests/unit -q 2>&1 | tail -5" }),
    true,
    "a read-only tail suffix must not hide targeted verification from the model"
  );
  assert.equal(
    guard.isToolAllowed("bash", { command: "python -m pytest tests/unit | sh" }),
    true,
    "ambiguous shell is delegated to the permission system"
  );
  assert.equal(guard.isToolAllowed("bash", { command: "eslint src --fix" }), true);
  assert.equal(guard.isToolAllowed("bash", { command: "ruff check --fix src" }), true);
  assert.equal(guard.isToolAllowed("bash", { command: "git diff --output=report.txt" }), true);
  assert.equal(guard.isToolAllowed("bash", { command: "tsc" }), true);
  assert.equal(guard.isToolAllowed("bash", { command: "tsc --noEmit" }), true);

  guard.recordObservationProgress([{
    tool: "read",
    failed: false,
    progressKind: "causal_repository_evidence",
    evidenceFingerprint: "read:unrelated",
  }]);
  assert.equal(guard.isToolAllowed("write"), true);
});

test("root-cause-linked repository evidence releases narrow recovery", () => {
  const guard = new RunEfficiencyGuard({ sameFailureLimit: 1, noProgressReplanLimit: 1, noProgressNarrowLimit: 2 });
  guard.recordTools([{ tool: "bash", failed: true, actionFingerprint: "bash:bad", failureFingerprint: "root:parser" }]);
  guard.recordProgress({ phase: "explore", kind: "no_progress", fingerprint: "one", value: 0 });
  guard.recordProgress({ phase: "explore", kind: "no_progress", fingerprint: "two", value: 0 });
  assert.equal(guard.isToolAllowed("write"), true);
  guard.recordObservationProgress([{
    tool: "repo_query",
    failed: false,
    progressKind: "causal_repository_evidence",
    evidenceFingerprint: "repo:parser-branch",
    rootCauseId: "root:parser",
  }]);
  assert.equal(guard.isToolAllowed("write"), true);
});

test("repository evidence releases exploration-only recovery without a failure root cause", () => {
  const guard = new RunEfficiencyGuard({ noProgressReplanLimit: 1, noProgressNarrowLimit: 2 });
  guard.recordProgress({ phase: "explore", kind: "no_progress", fingerprint: "read:one", value: 0 });
  guard.recordProgress({ phase: "explore", kind: "no_progress", fingerprint: "read:two", value: 0 });
  assert.equal(guard.isToolAllowed("patch"), true);

  guard.recordObservationProgress([{
    tool: "repo_map",
    failed: false,
    progressKind: "causal_repository_evidence",
    evidenceFingerprint: "repo-map:qdp-command-parser",
  }]);

  assert.equal(guard.getPhase(), "explore");
  assert.equal(guard.isToolAllowed("patch"), true);
  assert.equal(guard.isToolAllowed("write"), true);
});

test("successful mutation forces targeted verification before more exploration", () => {
  const guard = new RunEfficiencyGuard();
  const signal = guard.recordTools([{
    tool: "patch",
    failed: false,
    actionFingerprint: "patch:parser",
    targetPath: "src/parser.ts",
    mutation: "updated",
    mutationId: "mutation:parser",
  }]);
  assert.equal(signal?.directive.action, "verify_or_finish");
  assert.equal(guard.getPhase(), "verify");
  assert.equal(guard.isToolAllowed("search"), true);
  assert.equal(guard.isToolAllowed("read"), true);
  assert.equal(guard.isToolAllowed("patch"), true);
  assert.equal(guard.isToolAllowed("bash", { command: "npm test" }), true);
});

test("unverified consecutive mutations stay in one deliverable scope", () => {
  const guard = new RunEfficiencyGuard();
  guard.recordTools([{
    tool: "patch",
    failed: false,
    actionFingerprint: "patch:qdp",
    changedPaths: ["astropy/io/ascii/qdp.py"],
    mutation: "updated",
    mutationId: "mutation:qdp",
    workspaceFingerprint: "head:qdp",
  }]);
  guard.recordTools([{
    tool: "write",
    failed: false,
    actionFingerprint: "write:probe",
    changedPaths: ["_probe.py"],
    mutation: "created",
    mutationId: "mutation:probe",
    workspaceFingerprint: "head:qdp-and-probe",
  }]);

  assert.equal(guard.getProgressState().activeMutationId, "mutation:qdp");
  assert.equal(
    guard.getProgressState().activeMutationWorkspaceFingerprint,
    "head:qdp-and-probe",
  );
  assert.deepEqual(
    guard.getActiveMutationPaths(),
    ["astropy/io/ascii/qdp.py", "_probe.py"],
  );

  const restored = new RunEfficiencyGuard({ initialState: guard.getProgressState() });
  assert.equal(restored.getProgressState().activeMutationId, "mutation:qdp");
  assert.equal(
    restored.getProgressState().activeMutationWorkspaceFingerprint,
    "head:qdp-and-probe",
  );
  assert.deepEqual(
    restored.getActiveMutationPaths(),
    ["astropy/io/ascii/qdp.py", "_probe.py"],
  );
});

test("post-mutation stagnation keeps targeted correction tools available", () => {
  const guard = new RunEfficiencyGuard({ noProgressReplanLimit: 1, noProgressNarrowLimit: 2 });
  guard.recordTools([{
    tool: "patch",
    failed: false,
    actionFingerprint: "patch:qdp",
    targetPath: "astropy/io/ascii/qdp.py",
    mutation: "updated",
    mutationId: "mutation:qdp",
  }]);

  guard.recordProgress({ phase: "verify", kind: "no_progress", fingerprint: "read:qdp", value: 0 });
  const narrowed = guard.recordProgress({
    phase: "verify",
    kind: "no_progress",
    fingerprint: "verify:qdp:missing-dependency",
    value: 0,
  });

  assert.equal(narrowed?.directive.action, "narrow_recovery");
  assert.deepEqual(
    narrowed?.directive.action === "narrow_recovery" ? narrowed.directive.allowedTools : [],
    ["repo_query", "impact_analysis", "read", "patch", "write", "bash"]
  );
  assert.equal(guard.isToolAllowed("patch"), true);
  assert.equal(guard.isToolAllowed("write"), true);
  assert.equal(guard.isToolAllowed("bash", { command: "python -m pytest astropy/io/ascii/tests/test_qdp.py" }), true);
  assert.equal(guard.isToolAllowed("search"), true);
});

test("verification pass enters finish while verification failure stays in targeted recovery", () => {
  const passing = new RunEfficiencyGuard();
  passing.recordTools([{ tool: "patch", failed: false, actionFingerprint: "patch:a", targetPath: "a.ts", mutation: "updated", mutationId: "m:a", workspaceFingerprint: "head:dirty" }]);
  const passSignal = passing.recordObservationProgress([{
    tool: "verify",
    failed: false,
    progressKind: "verification_delta",
    evidenceFingerprint: "verify:pass",
    verifierId: "test:a",
    mutationId: "m:a",
    verificationBaseFingerprint: "head:dirty",
    workspaceFingerprint: "head:dirty",
    verificationVerdict: "pass",
  }]);
  assert.equal(passSignal?.directive.action, "verify_or_finish");
  assert.equal(passing.getPhase(), "finalize");
  assert.equal(passing.isToolAllowed("write"), true);

  const failing = new RunEfficiencyGuard();
  failing.recordTools([{ tool: "patch", failed: false, actionFingerprint: "patch:b", targetPath: "b.ts", mutation: "updated", mutationId: "m:b" }]);
  const failSignal = failing.recordTools([{
    tool: "bash",
    failed: true,
    actionFingerprint: "bash:test-b",
    progressKind: "verification_delta",
    evidenceFingerprint: "verify:fail",
    verifierId: "test:b",
    verificationVerdict: "fail",
    failureFingerprint: "assertion:b",
  }]);
  assert.equal(failSignal?.directive.action, "narrow_recovery");
  assert.equal(failing.getPhase(), "repair");
  assert.equal(failing.isToolAllowed("search"), true);
  assert.equal(failing.isToolAllowed("patch"), true);
});

test("unrelated or unbound verification cannot finalize an active mutation", () => {
  const guard = new RunEfficiencyGuard();
  guard.recordTools([{ tool: "patch", failed: false, actionFingerprint: "patch:a", targetPath: "a.ts", changedPaths: ["a.ts"], mutation: "updated", mutationId: "m:a" }]);
  for (const observation of [
    { tool: "bash", failed: false, progressKind: "verification_delta", evidenceFingerprint: "bash:pass", verifierId: "ad-hoc", mutationId: "m:a", workspaceFingerprint: "head:dirty", verificationVerdict: "pass" },
    { tool: "verify", failed: false, progressKind: "verification_delta", evidenceFingerprint: "verify:wrong", verifierId: "test:a", mutationId: "m:other", workspaceFingerprint: "head:dirty", verificationVerdict: "pass" },
    { tool: "verify", failed: false, progressKind: "verification_delta", evidenceFingerprint: "verify:stale", verifierId: "test:a", mutationId: "m:a", verificationVerdict: "pass" },
  ]) {
    guard.recordObservationProgress([observation]);
    assert.notEqual(guard.getPhase(), "finalize");
  }
});

test("pending background side effects persist in progress state until completion", () => {
  const guard = new RunEfficiencyGuard();
  guard.recordTools([{ tool: "bash", failed: false, backgroundTaskStarted: "bg_1" }]);
  assert.deepEqual(guard.getProgressState().pendingSideEffectIds, ["bg_1"]);
  guard.recordTools([{ tool: "bg_wait", failed: false, backgroundTaskCompleted: "bg_1" }]);
  assert.deepEqual(guard.getProgressState().pendingSideEffectIds, []);
});

test("verification must start from the active mutation workspace fingerprint", () => {
  const guard = new RunEfficiencyGuard();
  guard.recordTools([{ tool: "patch", failed: false, actionFingerprint: "patch:a", changedPaths: ["a.ts"], mutation: "updated", mutationId: "m:a", workspaceFingerprint: "workspace:mutation" }]);
  guard.recordObservationProgress([{ tool: "verify", failed: false, progressKind: "verification_delta", evidenceFingerprint: "verify:pass:stale-base", verifierId: "test:a", mutationId: "m:a", verificationBaseFingerprint: "workspace:changed-later", workspaceFingerprint: "workspace:changed-later", verificationVerdict: "pass" }]);
  assert.notEqual(guard.getPhase(), "finalize");
  assert.equal(guard.getProgressState().latestVerificationVerdict, "blocked");
  assert.equal(guard.getProgressState().activeMutationWorkspaceFingerprint, "workspace:changed-later");
  assert.deepEqual(guard.getActiveMutationPaths(), []);
});

test("a later new observation wins over repeated evidence in the same batch", () => {
  const guard = new RunEfficiencyGuard({ noProgressReplanLimit: 1, noProgressNarrowLimit: 2 });
  guard.recordObservationProgress([{
    tool: "read",
    failed: false,
    progressKind: "causal_repository_evidence",
    evidenceFingerprint: "read:old",
  }]);
  const signal = guard.recordObservationProgress([
    { tool: "repo_query", failed: false, progressKind: "causal_repository_evidence", evidenceFingerprint: "read:old" },
    { tool: "repo_query", failed: false, progressKind: "causal_repository_evidence", evidenceFingerprint: "read:new" },
  ]);
  assert.equal(signal, null);
  assert.equal(guard.isToolAllowed("write"), true);
});

test("failed threshold reporting does not discard new evidence later in the batch", () => {
  const guard = new RunEfficiencyGuard({ sameFailureLimit: 1, noProgressReplanLimit: 1, noProgressNarrowLimit: 2 });
  const observations = [
    { tool: "bash", failed: true, actionFingerprint: "bash:bad", failureFingerprint: "bad" },
    { tool: "repo_query", failed: false, progressKind: "causal_repository_evidence", evidenceFingerprint: "read:new", rootCauseId: "bad" },
  ];
  assert.equal(guard.recordTools(observations)?.directive.action, "correct_parameters");
  assert.equal(guard.recordObservationProgress(observations), null);
  assert.equal(guard.isActionBlocked("bash:bad"), false, "new evidence should release the stale action block");
});

test("historical 14182 and 14365 receive verify advice without a hard capability denial", () => {
  const traces = {
    "astropy__astropy-14182": ["patch", "bash", "bash", "bash", "read", "bash"],
    "astropy__astropy-14365": ["patch", "bash", "read", "patch", "read", "search", "search", "read", "bash"],
  };
  for (const [instanceId, tools] of Object.entries(traces)) {
    const guard = new RunEfficiencyGuard();
    guard.recordTools([{
      tool: "patch",
      failed: false,
      actionFingerprint: `${instanceId}:first-mutation`,
      targetPath: "astropy/io/ascii/target.py",
      mutation: "updated",
      mutationId: `${instanceId}:mutation`,
    }]);
    const postMutationSearches = tools.slice(1).filter((tool) => tool === "search");
    assert.ok(postMutationSearches.every((tool) => guard.isToolAllowed(tool)), instanceId);
    assert.equal(guard.getPhase(), "verify");
  }
});

test("waiting without tool observations does not accumulate stagnation", () => {
  const guard = new RunEfficiencyGuard({ noProgressReplanLimit: 1, noProgressNarrowLimit: 2 });
  assert.equal(guard.recordObservationProgress([]), null);
  assert.equal(guard.getPhase(), "explore");
  assert.equal(guard.isToolAllowed("write"), true);
});

test("efficiency policy redirects do not count as failures or further stagnation", () => {
  const guard = new RunEfficiencyGuard({ sameFailureLimit: 1, noProgressReplanLimit: 1, noProgressNarrowLimit: 2 });
  guard.recordTools([{
    tool: "bash",
    failed: true,
    actionFingerprint: "bash:original-failure",
    failureFingerprint: "root:original",
  }]);
  const redirect = {
    tool: "bash",
    failed: false,
    redirected: true,
    actionFingerprint: "bash:disallowed-during-recovery",
  };
  const phaseBeforeRedirect = guard.getPhase();

  assert.equal(guard.recordTools([redirect]), null);
  assert.equal(guard.recordObservationProgress([redirect]), null);
  assert.equal(guard.getPhase(), phaseBeforeRedirect);
});

test("efficiency guard does not merge unrelated failures from the same tool", () => {
  const guard = new RunEfficiencyGuard();
  assert.equal(
    guard.recordTools([
      { tool: "bash", failed: true, failureFingerprint: "bash:runtime:not-found" },
    ]),
    null
  );
  assert.equal(
    guard.recordTools([
      { tool: "bash", failed: true, failureFingerprint: "bash:runtime:permission-denied" },
    ]),
    null
  );
});

test("efficiency guard caps total failures and automatic compactions", () => {
  const guard = new RunEfficiencyGuard({
    sameFailureLimit: 99,
    totalFailureLimit: 3,
    maxCompactions: 2,
    compactionCooldownTurns: 4,
  });
  assert.equal(guard.recordTools([{ tool: "a", failed: true, failureFingerprint: "1" }]), null);
  assert.equal(guard.recordTools([{ tool: "b", failed: true, failureFingerprint: "2" }]), null);
  const budgetSignal = guard.recordTools([{ tool: "c", failed: true, failureFingerprint: "3" }]);
  assert.equal(budgetSignal?.disposition, "redirect");
  assert.match(budgetSignal?.reason ?? "", /收敛探索范围/);
  assert.equal(
    guard.recordTools([{ tool: "d", failed: false }]),
    null,
    "successful progress should remain accepted after a redirect signal"
  );
  assert.equal(guard.canCompact(1), true);
  guard.recordCompaction(1);
  assert.equal(guard.canCompact(2), false);
  assert.equal(guard.canCompact(5), true);
  guard.recordCompaction(5);
  assert.equal(guard.canCompact(20), false);
});

test("efficiency guard deduplicates side effects and exposes created versus updated", () => {
  const guard = new RunEfficiencyGuard();
  guard.recordTools([
    { tool: "write", failed: false, targetPath: "a.txt", mutation: "created" },
    { tool: "write", failed: false, targetPath: "a.txt", mutation: "updated" },
    { tool: "patch", failed: false, targetPath: "b.ts", mutation: "updated" },
  ]);
  const ledger = guard.formatSideEffectLedger();
  assert.match(ledger, /a\.txt.*创建后更新/);
  assert.match(ledger, /b\.ts.*更新/);
  assert.equal((ledger.match(/a\.txt/g) ?? []).length, 1);
});

test("mandatory rules dynamic reference is short and does not duplicate rule text", () => {
  const rules = "必须先验证。".repeat(2000);
  const reference = buildMandatoryRulesReference(rules);
  assert.ok(reference.length < 220);
  assert.doesNotMatch(reference, /必须先验证。必须先验证。/);
  assert.match(reference, /system/i);
});
