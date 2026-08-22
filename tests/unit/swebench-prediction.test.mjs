import test from "node:test";
import assert from "node:assert/strict";

import * as swebenchPrediction from "../../dist/eval/swebench-prediction.js";
import { isRootDiagnosticArtifact, resolveExplicitDeliverablePaths } from "../../dist/diagnostic-artifact.js";
import {
  containsDiagnosticArtifact,
  containsTestArtifact,
  decideSwebenchPrediction,
  diagnosticArtifactPathspecExclusions,
  isOfficialGraderPendingCandidate,
  normalizeGitPatchForTransport,
} from "../../dist/eval/swebench-prediction.js";

test("SWE-bench prediction suppresses diagnostic diffs from incomplete agent runs", () => {
  assert.deepEqual(decideSwebenchPrediction({
    agentResultOk: false,
    latestVerificationVerdict: "blocked",
    patch: "diff --git a/_apply_patch.py b/_apply_patch.py\n",
  }), {
    eligible: false,
    modelPatch: "",
    reason: "agent_incomplete",
  });
});

test("SWE-bench prediction rejects root diagnostic artifacts", () => {
  const envDiagnosticPatch = [
    "diff --git a/env_check.py b/env_check.py",
    "--- /dev/null",
    "+++ b/env_check.py",
    "@@ -0,0 +1,2 @@",
    "+import sys",
    "+print(sys.version)",
    "",
  ].join("\n");
  const arbitraryNamePatch = envDiagnosticPatch.replaceAll("env_check.py", "versions.py");
  assert.equal(containsDiagnosticArtifact(["astropy/io/ascii/qdp.py", "_probe.py"]), true);
  assert.equal(containsDiagnosticArtifact(["astropy/io/ascii/qdp.py", "_tmp_regex_check.py"]), true);
  assert.equal(containsDiagnosticArtifact(["env_check.py"], envDiagnosticPatch), true);
  assert.equal(containsDiagnosticArtifact(["versions.py"], arbitraryNamePatch), true);
  assert.equal(containsDiagnosticArtifact(["tests/helpers/probe.py"]), false);
  assert.deepEqual(decideSwebenchPrediction({
    agentResultOk: true,
    latestVerificationVerdict: "pass",
    changedFiles: ["astropy/io/ascii/qdp.py", "_probe.py"],
    patch: "diff --git a/astropy/io/ascii/qdp.py b/astropy/io/ascii/qdp.py\n",
  }), {
    eligible: false,
    modelPatch: "",
    reason: "diagnostic_artifact_present",
  });
  const trackedPatch = envDiagnosticPatch.replaceAll("env_check.py", "check_env.py");
  assert.deepEqual(decideSwebenchPrediction({
    agentResultOk: true,
    latestVerificationVerdict: "pass",
    changedFiles: ["check_env.py"],
    untrackedFiles: [],
    patch: trackedPatch,
  }), { eligible: true, modelPatch: trackedPatch });
  assert.deepEqual(diagnosticArtifactPathspecExclusions([], trackedPatch), []);
  assert.deepEqual(decideSwebenchPrediction({
    agentResultOk: true,
    latestVerificationVerdict: "pass",
    changedFiles: ["check_env.py"],
    untrackedFiles: ["check_env.py"],
    patch: trackedPatch,
  }), { eligible: false, modelPatch: "", reason: "diagnostic_artifact_present" });
  assert.deepEqual(decideSwebenchPrediction({
    agentResultOk: true,
    latestVerificationVerdict: "pass",
    changedFiles: ["versions.py"],
    untrackedFiles: ["versions.py"],
    deliverableFiles: ["versions.py"],
    patch: arbitraryNamePatch,
  }), { eligible: true, modelPatch: arbitraryNamePatch });
});

test("SWE-bench prediction rejects test and test-configuration modifications", () => {
  assert.equal(containsTestArtifact(["astropy/io/ascii/tests/test_qdp.py"]), true);
  assert.equal(containsTestArtifact(["conftest.py"]), true);
  assert.equal(containsTestArtifact(["src/parser_test.ts"]), true);
  assert.equal(containsTestArtifact(["src/parser.spec.js"]), true);
  assert.equal(containsTestArtifact(["astropy/io/ascii/qdp.py"]), false);
  assert.deepEqual(decideSwebenchPrediction({
    agentResultOk: false,
    officialGraderPending: true,
    changedFiles: ["astropy/io/ascii/tests/test_qdp.py"],
    patch: "diff --git a/astropy/io/ascii/tests/test_qdp.py b/astropy/io/ascii/tests/test_qdp.py\n",
  }), { eligible: false, modelPatch: "", reason: "test_artifact_modified" });
});

test("SWE-bench source observation excludes only known root diagnostics", () => {
  const patch = [
    "diff --git a/fix_qdp_case.py b/fix_qdp_case.py",
    "--- /dev/null",
    "+++ b/fix_qdp_case.py",
    "@@ -0,0 +1 @@",
    "+open('astropy/io/ascii/qdp.py', 'w').write(source.replace(old, new))",
    "diff --git a/fix_parser.py b/fix_parser.py",
    "--- /dev/null",
    "+++ b/fix_parser.py",
    "@@ -0,0 +1,2 @@",
    "+def fix_parser(value):",
    "+    return value.strip()",
    "",
  ].join("\n");
  assert.deepEqual(
    diagnosticArtifactPathspecExclusions([
      "astropy/io/ascii/qdp.py",
      "_verify_qdp_fix.py",
      "tests/helpers/probe.py",
      "debug.py",
      "fix_qdp_case.py",
      "fix_parser.py",
      "_tmp_regex_check.py",
    ], patch),
    ["_verify_qdp_fix.py", "debug.py", "fix_qdp_case.py", "_tmp_regex_check.py"],
  );
  assert.equal(containsDiagnosticArtifact(["fix_parser.py"], patch), false);
});

test("SWE-bench source candidate excludes generated caches and root probe artifacts", () => {
  assert.equal(typeof swebenchPrediction.decideSwebenchSourcePrediction, "function");
  const sourcePatch = "diff --git a/src/core.py b/src/core.py\n--- a/src/core.py\n+++ b/src/core.py\n@@ -1 +1 @@\n-old\n+new\n";
  const rawPatch = `${sourcePatch}diff --git a/pip/cache/item.body b/pip/cache/item.body\n--- /dev/null\n+++ b/pip/cache/item.body\n@@ -0,0 +1 @@\n+cache\ndiff --git a/verify_redirect_fix.py b/verify_redirect_fix.py\n--- /dev/null\n+++ b/verify_redirect_fix.py\n@@ -0,0 +1 @@\n+print('probe')\n`;
  const diagnosticFiles = diagnosticArtifactPathspecExclusions([
    "src/core.py",
    "pip/cache/item.body",
    "verify_redirect_fix.py",
    "env_check_out.txt",
  ], rawPatch);
  assert.deepEqual(diagnosticFiles, [
    "pip/cache/item.body",
    "verify_redirect_fix.py",
    "env_check_out.txt",
  ]);
  assert.deepEqual(swebenchPrediction.decideSwebenchSourcePrediction({
    agentResultOk: false,
    officialGraderPending: true,
    rawPatch,
    sourcePatch,
    changedFiles: ["src/core.py", ...diagnosticFiles],
    untrackedFiles: diagnosticFiles,
    diagnosticFiles,
  }), { eligible: true, modelPatch: sourcePatch });
});

test("SWE-bench source candidate excludes arbitrary zz-prefixed root diagnostics", () => {
  const sourcePatch = "diff --git a/requests/sessions.py b/requests/sessions.py\n--- a/requests/sessions.py\n+++ b/requests/sessions.py\n@@ -1 +1 @@\n-old\n+new\n";
  const diagnosticPatch = "diff --git a/zz_repro.py b/zz_repro.py\n--- /dev/null\n+++ b/zz_repro.py\n@@ -0,0 +1 @@\n+assert True\ndiff --git a/zz_out.txt b/zz_out.txt\n--- /dev/null\n+++ b/zz_out.txt\n@@ -0,0 +1 @@\n+SyntaxError\n";
  const rawPatch = sourcePatch + diagnosticPatch;
  const diagnosticFiles = diagnosticArtifactPathspecExclusions(["zz_repro.py", "zz_out.txt"], rawPatch);
  assert.deepEqual(diagnosticFiles, ["zz_repro.py", "zz_out.txt"]);
  assert.equal(isRootDiagnosticArtifact("zz_api.py", "export function api() {}"), false);
  assert.deepEqual(
    diagnosticArtifactPathspecExclusions(["zz_api.py"], "diff --git a/zz_api.py b/zz_api.py\nnew file mode 100644\n--- /dev/null\n+++ b/zz_api.py\n@@ -0,0 +1 @@\n+export function api() {}\n"),
    [],
  );
  assert.deepEqual(swebenchPrediction.decideSwebenchSourcePrediction({
    agentResultOk: true,
    latestVerificationVerdict: "pass",
    rawPatch,
    sourcePatch,
    diagnosticFiles,
    changedFiles: ["requests/sessions.py", "zz_repro.py", "zz_out.txt"],
    untrackedFiles: ["zz_repro.py", "zz_out.txt"],
  }), { eligible: true, modelPatch: sourcePatch });
});

test("SWE-bench source candidate excludes observed stdin runners and empty scratch files", () => {
  const patch = [
    "diff --git a/_runner.py b/_runner.py",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/_runner.py",
    "@@ -0,0 +1,2 @@",
    "+import sys",
    "+exec(sys.stdin.read())",
    "diff --git a/_t.txt b/_t.txt",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/_t.txt",
    "@@ -0,0 +1 @@",
    "+",
  ].join("\n");
  assert.deepEqual(
    diagnosticArtifactPathspecExclusions(["_runner.py", "_t.txt"], patch),
    ["_runner.py", "_t.txt"],
  );
});

test("SWE-bench source candidate excludes root environment, simulation, and smoke probes", () => {
  const patch = [
    "diff --git a/_checkenv.py b/_checkenv.py",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/_checkenv.py",
    "@@ -0,0 +1 @@",
    "+print('numpy OK')",
    "diff --git a/_sim_rst.py b/_sim_rst.py",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/_sim_rst.py",
    "@@ -0,0 +1 @@",
    "+print('standalone simulation')",
    "diff --git a/_smoke_rst.py b/_smoke_rst.py",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/_smoke_rst.py",
    "@@ -0,0 +1 @@",
    "+print('SMOKE_OK')",
  ].join("\n");
  assert.deepEqual(
    diagnosticArtifactPathspecExclusions(["_checkenv.py", "_sim_rst.py", "_smoke_rst.py"], patch),
    ["_checkenv.py", "_sim_rst.py", "_smoke_rst.py"],
  );
  const productionPatch = [
    "diff --git a/_sim_backend.py b/_sim_backend.py",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/_sim_backend.py",
    "@@ -0,0 +1,2 @@",
    "+def simulate(value):",
    "+    return value * 2",
  ].join("\n");
  assert.deepEqual(
    diagnosticArtifactPathspecExclusions(["_sim_backend.py"], productionPatch),
    [],
  );
  const productionSmokePatch = [
    "diff --git a/_smoke_backend.py b/_smoke_backend.py",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/_smoke_backend.py",
    "@@ -0,0 +1,2 @@",
    "+def smoke_backend():",
    "+    return 'ok'",
  ].join("\n");
  assert.deepEqual(
    diagnosticArtifactPathspecExclusions(["_smoke_backend.py"], productionSmokePatch),
    [],
  );
});

test("SWE-bench source candidate excludes observed QDP probes without broad test prefixes", () => {
  const patch = [
    "diff --git a/_test_qdp.py b/_test_qdp.py",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/_test_qdp.py",
    "@@ -0,0 +1 @@",
    "+print('qdp probe')",
    "diff --git a/_test_regex.py b/_test_regex.py",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/_test_regex.py",
    "@@ -0,0 +1 @@",
    "+print('regex probe')",
  ].join("\n");
  assert.deepEqual(
    diagnosticArtifactPathspecExclusions(["_test_qdp.py", "_test_regex.py"], patch),
    ["_test_qdp.py", "_test_regex.py"],
  );
  assert.deepEqual(
    diagnosticArtifactPathspecExclusions(["_test_backend.py"], [
      "diff --git a/_test_backend.py b/_test_backend.py",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/_test_backend.py",
      "@@ -0,0 +1,2 @@",
      "+def validate_backend(value):",
      "+    return value is not None",
    ].join("\n")),
    [],
  );
});

test("SWE-bench source candidate excludes the observed standalone QDP probe only", () => {
  const patch = [
    "diff --git a/tmptest_qdp_standalone.py b/tmptest_qdp_standalone.py",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/tmptest_qdp_standalone.py",
    "@@ -0,0 +1 @@",
    "+print('standalone qdp probe')",
  ].join("\n");
  assert.deepEqual(
    diagnosticArtifactPathspecExclusions(["tmptest_qdp_standalone.py"], patch),
    ["tmptest_qdp_standalone.py"],
  );
  assert.deepEqual(
    diagnosticArtifactPathspecExclusions(["tmptest_qdp_backend.py"], patch.replaceAll("tmptest_qdp_standalone.py", "tmptest_qdp_backend.py")),
    [],
  );
});

test("SWE-bench source candidate excludes an untracked root dependency test shim", () => {
  const patch = [
    "diff --git a/np_shim.py b/np_shim.py",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/np_shim.py",
    "@@ -0,0 +1,4 @@",
    "+import numpy as np",
    "+# Restore aliases removed in NumPy 2.0 for old xarray compatibility (test-only shim)",
    "+if not hasattr(np, 'unicode_'):",
    "+    setattr(np, 'unicode_', np.str_)",
  ].join("\n");
  assert.deepEqual(diagnosticArtifactPathspecExclusions(["np_shim.py"], patch), ["np_shim.py"]);
});

test("SWE-bench source candidate preserves a production dependency shim", () => {
  const patch = [
    "diff --git a/numpy_shim.py b/numpy_shim.py",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/numpy_shim.py",
    "@@ -0,0 +1,3 @@",
    "+import numpy as np",
    "+if not hasattr(np, 'unicode_'):",
    "+    setattr(np, 'unicode_', np.str_)",
  ].join("\n");
  assert.deepEqual(diagnosticArtifactPathspecExclusions(["numpy_shim.py"], patch), []);
});

test("explicit deliverables normalize aliases and absolute workspace paths", () => {
  const workspace = "C:\\work\\repo";
  assert.deepEqual(resolveExplicitDeliverablePaths(workspace, [
    "./zz_api.py",
    "workspace_dir/zz_config.ts",
    "C:\\work\\repo\\zz_cli.py",
    "C:\\outside\\nope.py",
  ].join(",")), ["zz_api.py", "zz_config.ts", "zz_cli.py"]);
});

test("SWE-bench prediction requires a fresh deterministic verification pass", () => {
  assert.deepEqual(decideSwebenchPrediction({
    agentResultOk: true,
    patch: "diff --git a/src.py b/src.py\n",
  }), {
    eligible: false,
    modelPatch: "",
    reason: "verification_not_passed",
  });
  assert.deepEqual(decideSwebenchPrediction({
    agentResultOk: true,
    latestVerificationVerdict: "fail",
    patch: "diff --git a/src.py b/src.py\n",
  }), {
    eligible: false,
    modelPatch: "",
    reason: "verification_not_passed",
  });
});

test("SWE-bench prediction can submit an environment-paused candidate only to the official grader", () => {
  const patch = "diff --git a/src.py b/src.py\n";
  assert.deepEqual(decideSwebenchPrediction({
    agentResultOk: false,
    officialGraderPending: true,
    patch,
  }), { eligible: true, modelPatch: patch });
  assert.deepEqual(decideSwebenchPrediction({
    agentResultOk: false,
    patch,
  }), { eligible: false, modelPatch: "", reason: "agent_incomplete" });
});

test("official grader pending evidence fails closed around recovery and side effects", () => {
  const valid = {
    agentOutcome: "paused",
    resultText: "验证环境未就绪；修改已保留为可恢复状态。",
    checkpoint: {
      phase: "verify",
      workspaceCaptureAvailable: true,
      progressState: {
        activeMutationId: "patch:abc",
        activeMutationPaths: ["src.py"],
        pendingSideEffectIds: [],
      },
    },
  };
  assert.equal(isOfficialGraderPendingCandidate(valid), true);
  assert.equal(isOfficialGraderPendingCandidate({
    ...valid,
    resultText: "验证环境未就绪：修改 patch:abc 尚无可用的确定性验证器。",
  }), true);
  assert.equal(isOfficialGraderPendingCandidate({ ...valid, agentOutcome: "exhausted" }), false);
  assert.equal(isOfficialGraderPendingCandidate({ ...valid, resultText: "maximum iterations reached" }), false);
  assert.equal(isOfficialGraderPendingCandidate({ ...valid, checkpoint: { ...valid.checkpoint, workspaceCaptureAvailable: false } }), false);
  assert.equal(isOfficialGraderPendingCandidate({ ...valid, checkpoint: { ...valid.checkpoint, latestVerification: { verdict: "fail" } } }), false);
  assert.equal(isOfficialGraderPendingCandidate({ ...valid, checkpoint: {
    ...valid.checkpoint,
    progressState: { ...valid.checkpoint.progressState, activeMutationPaths: ["<unknown-background-outcome>"] },
  } }), false);
  assert.equal(isOfficialGraderPendingCandidate({ ...valid, checkpoint: {
    ...valid.checkpoint,
    progressState: { ...valid.checkpoint.progressState, pendingSideEffectIds: ["bg-1"] },
  } }), false);
});

test("SWE-bench prediction exports only a verified non-empty patch", () => {
  const patch = "diff --git a/src.py b/src.py\n";
  assert.deepEqual(decideSwebenchPrediction({
    agentResultOk: true,
    latestVerificationVerdict: "pass",
    patch,
  }), { eligible: true, modelPatch: patch });
  assert.deepEqual(decideSwebenchPrediction({
    agentResultOk: true,
    latestVerificationVerdict: "pass",
    patch: "  \n",
  }), { eligible: false, modelPatch: "", reason: "empty_patch" });
});

test("SWE-bench prediction normalizes Windows patch transport to LF", () => {
  const windowsPatch = [
    "diff --git a/src.py b/src.py",
    "--- a/src.py",
    "+++ b/src.py",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "",
  ].join("\r\n");
  const normalized = normalizeGitPatchForTransport(windowsPatch);
  assert.equal(normalized.includes("\r"), false);
  assert.equal(decideSwebenchPrediction({
    agentResultOk: true,
    latestVerificationVerdict: "pass",
    patch: windowsPatch,
  }).modelPatch, normalized);
});

test("SWE-bench model route accepts the official Weixin Coding Plan OpenAI endpoint", () => {
  assert.equal(typeof swebenchPrediction.isSupportedSwebenchModelRoute, "function");
  assert.equal(swebenchPrediction.isSupportedSwebenchModelRoute?.({
    provider: "openai",
    endpoint: "https://chatapi.weixin.qq.com/openai/v1",
    model: "Deepseek-v4-flash",
  }), true);
  assert.equal(swebenchPrediction.isSupportedSwebenchModelRoute?.({
    provider: "deepseek",
    endpoint: "https://api.deepseek.com",
    model: "deepseek-chat",
  }), true);
});

test("SWE-bench model route rejects untrusted OpenAI-compatible endpoints", () => {
  assert.equal(typeof swebenchPrediction.isSupportedSwebenchModelRoute, "function");
  for (const endpoint of [
    "https://api.openai.com/v1",
    "https://chatapi.weixin.qq.com.evil.example/openai/v1",
    "http://chatapi.weixin.qq.com/openai/v1",
    "https://chatapi.weixin.qq.com/openai/v2",
  ]) {
    assert.equal(swebenchPrediction.isSupportedSwebenchModelRoute?.({
      provider: "openai",
      endpoint,
      model: "Deepseek-v4-flash",
    }), false, endpoint);
  }
});

test("SWE-bench agent isolation disables unsupported semantic embeddings", () => {
  assert.equal(typeof swebenchPrediction.buildSwebenchAgentEnvironment, "function");
  const base = {
    QLING_FEATURES_SEMANTIC_MEMORY: "true",
    QLING_LLM_MODEL: "Deepseek-v4-flash",
  };
  const isolated = swebenchPrediction.buildSwebenchAgentEnvironment?.(base);
  assert.equal(isolated?.QLING_FEATURES_SEMANTIC_MEMORY, "false");
  assert.equal(isolated?.QLING_LLM_MODEL, "Deepseek-v4-flash");
  assert.equal(base.QLING_FEATURES_SEMANTIC_MEMORY, "true");
});
