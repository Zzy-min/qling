import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { executePreparedTools } from "../../dist/agent/tool-orchestrator.js";
import { RunEfficiencyGuard, classifyToolProgressKind } from "../../dist/agent/run-efficiency.js";
import { auditClaimsAgainstEvidence, evaluateTaskResult } from "../../dist/session/outcome-evidence.js";
import { ExecutionEventBus } from "../../dist/execution/event-bus.js";
import { runWithRuntimeRoots } from "../../dist/runtime-paths.js";
import { fileRevision, lineAnchor } from "../../dist/tools/anchored-edit.js";

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "qling-production-paths-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const a = path.join(root, "a");
  const b = path.join(root, "b");
  mkdirSync(a); mkdirSync(b);
  execFileSync("git", ["init", "--quiet", a], { windowsHide: true });
  execFileSync("git", ["init", "--quiet", b], { windowsHide: true });
  const saved = { ...process.env };
  Object.assign(process.env, { QLING_FEATURES_RELIABILITY_V2: "true", QLING_FEATURES_TRUST_BOUNDARY: "false", QLING_FEATURES_WORKFLOW_RUNTIME: "false", QLING_GIT_AUTO_COMMIT: "off", QLING_CODE_RUNTIME: "native", QLING_SANDBOX_PROFILE: "workspace-write" });
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); });
  const roots = { workspaceDir: a, fileStateDir: path.join(root, "state"), fileCacheDir: path.join(root, "cache") };
  return { root, a, b, roots };
}

async function execute(workspaceDir, roots, calls, overrides = {}) {
  const messages = [{ role: "user", content: "Modify report.md and run the requested local checks." }];
  const result = await runWithRuntimeRoots(roots, () => executePreparedTools({
    pipeline: { execute: async (call, dispatch) => dispatch(call) },
    tools: [], guardConfig: { enabled: false }, channel: null, approvalGate: {},
    knowledgeAdapter: { onToolCall() {}, onToolResult() {} }, memoryStore: { link() {} },
    workspaceDir, fileStateDir: roots.fileStateDir, workflowRuntime: {},
    executionEventBus: new ExecutionEventBus(), emit() {},
    reflectiveThink: async () => ({ decision: "proceed", reason: "" }), ...overrides,
  }, { preparedCalls: calls.map((call, i) => ({ call: { id: `fixture-${i}`, ...call } })), messages, runId: "fixture-run", attemptId: "fixture-attempt" }));
  return { ...result, messages };
}

for (const prompt of ["Modify report.md", "修改 report.md", "Create report.md"]) {
  test(`user target requires actual mutation even when model only says Done: ${prompt}`, (t) => {
    const { a } = fixture(t);
    const report = evaluateTaskResult({ userPrompt: prompt, finalText: "Done.", workspaceDir: a, toolExecutions: [{ tool: "bash", command: "pwd", exitCode: 0, failed: false }] });
    assert.equal(report.allowFinish, false);
    assert.ok(report.claimAuditFindings.some(item => item.kind === "unbacked_file_mutation_claim"));
  });
}

test("explanation, QA, and explicit no-edit requests do not demand mutation", (t) => {
  const { a } = fixture(t);
  for (const prompt of ["Explain how to modify report.md", "解释如何修改 report.md", "Do not modify report.md; explain it.", "不要修改 report.md，只解释内容", "What is Markdown?"]) {
    assert.equal(evaluateTaskResult({ userPrompt: prompt, finalText: "Markdown is plain text.", workspaceDir: a, toolExecutions: [] }).allowFinish, true, prompt);
  }
  const blocked = evaluateTaskResult({ userPrompt: "Modify report.md", finalText: "因无权限无法修改，尚未完成，待授权后继续。", workspaceDir: a, toolExecutions: [{ tool: "write", failed: true, blocked: true }] });
  assert.equal(blocked.allowFinish, false);
  assert.ok(!blocked.claimAuditFindings.some(item => item.kind === "unbacked_file_mutation_claim"));
  const englishBlocked = evaluateTaskResult({ userPrompt: "Modify report.md", finalText: "I cannot modify it due to missing write permission.", workspaceDir: a, toolExecutions: [{ tool: "write", failed: true, blocked: true }] });
  assert.ok(!englishBlocked.claimAuditFindings.some(item => item.kind === "unbacked_file_mutation_claim"));
});

test("production fallback binds host workspace, ignoring both model root arguments", async (t) => {
  const { a, b, roots } = fixture(t);
  const result = await execute(b, roots, [{ name: "write", arguments: { path: "report.md", content: "host B\n", workspaceDir: a, __qling_workspace_dir: a } }]);
  assert.equal(result.turnToolFailures, 0);
  assert.equal(existsSync(path.join(a, "report.md")), false);
  assert.equal(readFileSync(path.join(b, "report.md"), "utf8"), "host B\n");
  assert.equal(result.observations[0].targetPath, path.join(b, "report.md"));
});

test("actual anchored alias patch records the changed host file, but dry run/failure do not", async (t) => {
  const { a, roots } = fixture(t);
  const initial = "before\n";
  writeFileSync(path.join(a, "report.md"), initial);
  const args = { path: "workspace_dir/report.md", file_revision: fileRevision(initial), edits: [{ anchor: `1:${lineAnchor(initial.split(/\r?\n/), 0)}`, replace: "after" }] };
  const dry = await execute(a, roots, [{ name: "patch_anchored", arguments: { ...args, dry_run: true } }]);
  assert.equal(dry.observations[0].mutation, undefined);
  assert.equal(readFileSync(path.join(a, "report.md"), "utf8"), initial);
  assert.equal(evaluateTaskResult({ userPrompt: "Modify report.md", finalText: "Done.", workspaceDir: a, toolExecutions: dry.observations }).allowFinish, false);
  assert.equal(evaluateTaskResult({ userPrompt: "Modify report.md", finalText: "Modified report.md", workspaceDir: a, toolExecutions: dry.observations }).allowFinish, false);
  const patched = await execute(a, roots, [{ name: "patch_anchored", arguments: args }]);
  assert.equal(patched.turnToolFailures, 0);
  assert.equal(readFileSync(path.join(a, "report.md"), "utf8"), "after\n");
  assert.equal(patched.observations[0].targetPath, path.join(a, "report.md"));
  assert.deepEqual(patched.observations[0].changedPaths, ["report.md"]);
  assert.equal(patched.observations[0].mutation, "updated");
  assert.equal(auditClaimsAgainstEvidence({ userPrompt: "Modify report.md", finalText: "Modified report.md", workspaceDir: a, toolExecutions: patched.observations }).length, 0);
  const failed = await execute(a, roots, [{ name: "patch_anchored", arguments: { ...args, edits: [{ anchor: "1:00000000", replace: "wrong" }] } }]);
  assert.equal(failed.observations[0].failed, true);
  assert.equal(failed.observations[0].mutation, undefined);
});

function createChecks(workspace) {
  writeFileSync(path.join(workspace, "package.json"), JSON.stringify({ scripts: { test: "node --test --test-name-pattern=pass check.test.mjs", build: "node -e \"process.exit(0)\"" } }));
  writeFileSync(path.join(workspace, "check.test.mjs"), 'import test from "node:test"; test("pass", () => {}); test("fail", () => { throw new Error("synthetic failure"); });\n');
}

test("real bash npm test producer records successful deterministic verification", async (t) => {
  const { a, roots } = fixture(t); createChecks(a);
  const result = await execute(a, roots, [{ name: "bash", arguments: { command: "npm test", timeout: 30 } }]);
  const observation = result.observations[0];
  assert.equal(observation.failed, false);
  assert.equal(observation.exitCode, 0);
  assert.equal(observation.progressKind, "verification_delta");
  assert.equal(observation.verificationVerdict, "pass");
  assert.equal(observation.verificationBaseFingerprint, observation.workspaceFingerprint);
  assert.equal(evaluateTaskResult({ userPrompt: "Run tests", finalText: "Tests passed.", workspaceDir: a, toolExecutions: result.observations }).allowFinish, true);
});

test("real bash failed test then pass recovers the same unchanged mutation", async (t) => {
  const { a, roots } = fixture(t); createChecks(a);
  const guard = new RunEfficiencyGuard();
  const changed = await execute(a, roots, [{ name: "write", arguments: { path: "report.md", content: "changed\n" } }]);
  guard.recordTools(changed.observations);
  const failed = await execute(a, roots, [{ name: "bash", arguments: { command: "node --test --test-name-pattern=fail check.test.mjs", timeout: 30 } }]);
  guard.recordTools(failed.observations); guard.recordObservationProgress(failed.observations);
  assert.equal(guard.getProgressState().latestVerificationVerdict, "fail");
  const passed = await execute(a, roots, [{ name: "bash", arguments: { command: "npm test", timeout: 30 } }]);
  guard.recordTools(passed.observations); guard.recordObservationProgress(passed.observations);
  assert.equal(guard.getProgressState().latestVerificationVerdict, "pass");
  assert.equal(guard.getProgressState().phase, "finalize");
});

test("passing another verification family cannot erase an unresolved test failure", async (t) => {
  const { a, roots } = fixture(t); createChecks(a);
  const guard = new RunEfficiencyGuard();
  const changed = await execute(a, roots, [{ name: "write", arguments: { path: "report.md", content: "changed\n" } }]); guard.recordTools(changed.observations);
  for (const command of ["node --test --test-name-pattern=fail check.test.mjs", "npm run build"]) {
    const batch = await execute(a, roots, [{ name: "bash", arguments: { command, timeout: 30 } }]);
    guard.recordTools(batch.observations); guard.recordObservationProgress(batch.observations);
  }
  assert.equal(guard.getProgressState().latestVerificationVerdict, "fail");
});

test("shell wrappers and old log output never become passing check evidence", async (t) => {
  const { a, roots } = fixture(t); createChecks(a);
  writeFileSync(path.join(a, "old.log"), "tests passed\n");
  for (const command of ["npm test || true", "echo npm test", process.platform === "win32" ? "type old.log" : "cat old.log"]) {
    const batch = await execute(a, roots, [{ name: "bash", arguments: { command, timeout: 30 } }]);
    assert.notEqual(batch.observations[0].verificationVerdict, "pass", command);
    assert.equal(classifyToolProgressKind("bash", { command }), undefined, command);
    assert.equal(evaluateTaskResult({ userPrompt: "Run tests", finalText: "Tests passed.", workspaceDir: a, toolExecutions: batch.observations }).allowFinish, false, command);
  }
});

test("check command recognition covers native families and rejects non-executing options", () => {
  for (const command of ["npm test", "npm run test", "npx tsc --noEmit", "pytest", "python -m pytest", "node --test", "npm run build", "ruff check ."]) {
    assert.equal(classifyToolProgressKind("bash", { command }), "verification_delta", command);
  }
  for (const command of ["pytest --collect-only", "npm test --help", "pytest --version", "npm test || true", "echo pytest", "cat old-test.log"]) {
    assert.notEqual(classifyToolProgressKind("bash", { command }), "verification_delta", command);
  }
});

test("explicit package and project selectors cannot establish host-root verification", () => {
  for (const command of [
    "npm test --prefix unrelated-package", "npm test --prefix=unrelated-package",
    "npm test --workspace unrelated-package", "npm test --workspace=unrelated-package",
    "npm test -w unrelated-package", "npm test -wunrelated-package", "npm test --workspaces",
    "npm test \"--prefix\" unrelated-package", "npm test '--prefix=unrelated-package'",
    "pnpm test --filter unrelated-package", "pnpm test --filter=unrelated-package",
    "pnpm test --dir unrelated-package", "pnpm test -C unrelated-package", "pnpm test -Cunrelated-package",
    "pnpm --filter unrelated-package test", "pnpm --dir unrelated-package test",
    "yarn test --cwd unrelated-package", "yarn --cwd unrelated-package test",
    "npx tsc --project unrelated-package --noEmit", "npx tsc -p unrelated-package --noEmit", "tsc -punrelated-package --noEmit",
    "pytest --rootdir unrelated-package", "python -m pytest --rootdir=unrelated-package",
  ]) {
    assert.equal(classifyToolProgressKind("bash", { command }), undefined, command);
    assert.equal(evaluateTaskResult({ userPrompt: "Run tests and typecheck", finalText: "Tests passed. Typecheck passed.", toolExecutions: [{ tool: "bash", command, exitCode: 0, failed: false }] }).allowFinish, false, command);
  }
});

test("real npm prefix selector succeeds in another package without verifying the host mutation", async (t) => {
  const { a, roots } = fixture(t); createChecks(a);
  const child = path.join(a, "unrelated-package"); mkdirSync(child); createChecks(child);
  const guard = new RunEfficiencyGuard();
  const changed = await execute(a, roots, [{ name: "write", arguments: { path: "report.md", content: "host change\n" } }]); guard.recordTools(changed.observations);
  for (const command of ["npm test --prefix unrelated-package", "npm test --prefix=unrelated-package"]) {
    const checked = await execute(a, roots, [{ name: "bash", arguments: { command, timeout: 30 } }]);
    assert.equal(checked.observations[0].failed, false);
    assert.equal(checked.observations[0].exitCode, 0);
    assert.notEqual(checked.observations[0].verificationVerdict, "pass");
    guard.recordTools(checked.observations); guard.recordObservationProgress(checked.observations);
    assert.notEqual(guard.getProgressState().latestVerificationVerdict, "pass");
    assert.equal(evaluateTaskResult({ userPrompt: "Run tests", finalText: "Tests passed.", workspaceDir: a, toolExecutions: checked.observations }).allowFinish, false);
  }
  const rootCheck = await execute(a, roots, [{ name: "bash", arguments: { command: "npm test", timeout: 30 } }]);
  assert.equal(rootCheck.observations[0].failed, false);
  assert.equal(rootCheck.observations[0].verificationVerdict, "pass");
  guard.recordTools(rootCheck.observations); guard.recordObservationProgress(rootCheck.observations);
  assert.equal(guard.getProgressState().latestVerificationVerdict, "pass");
});

test("a real passing shell check cannot reuse evidence from before a later write", async (t) => {
  const { a, roots } = fixture(t); createChecks(a);
  const guard = new RunEfficiencyGuard();
  const first = await execute(a, roots, [{ name: "write", arguments: { path: "report.md", content: "first\n" } }]); guard.recordTools(first.observations);
  const pass = await execute(a, roots, [{ name: "bash", arguments: { command: "npm test", timeout: 30 } }]);
  const later = await execute(a, roots, [{ name: "write", arguments: { path: "report.md", content: "later\n" } }]); guard.recordTools(later.observations);
  guard.recordTools(pass.observations); guard.recordObservationProgress(pass.observations);
  assert.notEqual(guard.getProgressState().latestVerificationVerdict, "pass");
  assert.notEqual(guard.getProgressState().phase, "finalize");
  guard.recordTools(pass.observations); guard.recordObservationProgress(pass.observations);
  assert.notEqual(guard.getProgressState().latestVerificationVerdict, "pass");
});

test("a check that changes its workspace cannot produce a passing verification", async (t) => {
  const { a, roots } = fixture(t);
  writeFileSync(path.join(a, "package.json"), JSON.stringify({ scripts: { test: "node mutate.mjs" } }));
  writeFileSync(path.join(a, "mutate.mjs"), 'import { writeFileSync } from "node:fs"; writeFileSync("report.md", "modified while checking\\n");\n');
  const batch = await execute(a, roots, [{ name: "bash", arguments: { command: "npm test", timeout: 30 } }]);
  assert.equal(batch.observations[0].exitCode, 0);
  assert.notEqual(batch.observations[0].verificationVerdict, "pass");
  assert.equal(batch.observations[0].verificationResultVerdict, "blocked");
});

test("a passing check in an unrelated package cannot verify the host workspace mutation", async (t) => {
  const { a, roots } = fixture(t);
  const child = path.join(a, "unrelated-package"); mkdirSync(child); createChecks(child);
  const guard = new RunEfficiencyGuard();
  const changed = await execute(a, roots, [{ name: "write", arguments: { path: "report.md", content: "host change\n" } }]); guard.recordTools(changed.observations);
  const checked = await execute(a, roots, [{ name: "bash", arguments: { command: "npm test", cwd: "unrelated-package", timeout: 30 } }]);
  assert.equal(checked.observations[0].failed, false);
  assert.equal(checked.observations[0].exitCode, 0);
  assert.notEqual(checked.observations[0].verificationVerdict, "pass");
  guard.recordTools(checked.observations); guard.recordObservationProgress(checked.observations);
  assert.notEqual(guard.getProgressState().latestVerificationVerdict, "pass");
  assert.equal(evaluateTaskResult({ userPrompt: "Run tests", finalText: "Tests passed.", workspaceDir: a, toolExecutions: checked.observations }).allowFinish, false);
});

test("verification family failures survive a serialized guard checkpoint", async (t) => {
  const { a, roots } = fixture(t); createChecks(a);
  const guard = new RunEfficiencyGuard();
  const changed = await execute(a, roots, [{ name: "write", arguments: { path: "report.md", content: "host change\n" } }]); guard.recordTools(changed.observations);
  const failed = await execute(a, roots, [{ name: "bash", arguments: { command: "node --test --test-name-pattern=fail check.test.mjs", timeout: 30 } }]); guard.recordTools(failed.observations);
  const restored = new RunEfficiencyGuard({ initialState: JSON.parse(JSON.stringify(guard.getProgressState())) });
  const legacyState = JSON.parse(JSON.stringify(guard.getProgressState())); delete legacyState.unresolvedVerificationFamilies;
  const legacyRestored = new RunEfficiencyGuard({ initialState: legacyState });
  const build = await execute(a, roots, [{ name: "bash", arguments: { command: "npm run build", timeout: 30 } }]);
  restored.recordTools(build.observations); restored.recordObservationProgress(build.observations);
  legacyRestored.recordTools(build.observations);
  const legacySignal = legacyRestored.recordObservationProgress(build.observations);
  assert.match(legacySignal.reason, /恢复快照缺少失败检查类型.*人工核对.*新 run/);
  assert.equal(legacyRestored.getProgressState().latestVerificationVerdict, "fail");
  assert.equal(restored.getProgressState().latestVerificationVerdict, "fail");
  assert.notEqual(restored.getProgressState().phase, "finalize");
  const pass = await execute(a, roots, [{ name: "bash", arguments: { command: "npm test", timeout: 30 } }]);
  restored.recordTools(pass.observations); restored.recordObservationProgress(pass.observations);
  assert.equal(restored.getProgressState().latestVerificationVerdict, "pass");
});

test("JSON audit enforces physical workspace boundaries and never includes parser input", (t) => {
  const { a, b } = fixture(t);
  const secret = "SYNTHETIC_PRIVATE_SENTINEL_827461";
  writeFileSync(path.join(b, "secret.json"), `{ "${secret}": bad }`);
  symlinkSync(b, path.join(a, "linked"), process.platform === "win32" ? "junction" : "dir");
  const outside = auditClaimsAgainstEvidence({ userPrompt: "Modify linked/secret.json", finalText: "Modified linked/secret.json", workspaceDir: a, toolExecutions: [{ tool: "write", failed: false, mutation: "updated", targetPath: path.join(a, "linked", "secret.json") }] });
  assert.ok(!outside.some(item => item.kind === "invalid_file_format_on_disk"));
  assert.ok(outside.some(item => item.kind === "unbacked_file_mutation_claim"));
  assert.ok(!JSON.stringify(outside).includes(secret));
  writeFileSync(path.join(a, "report.json"), `{ "${secret}": bad }`);
  const local = auditClaimsAgainstEvidence({ userPrompt: "Modify report.json", finalText: "Modified report.json", workspaceDir: a, toolExecutions: [{ tool: "write", failed: false, mutation: "updated", targetPath: "report.json" }] });
  assert.ok(local.some(item => item.kind === "invalid_file_format_on_disk"));
  assert.ok(!JSON.stringify(local).includes(secret));
});
