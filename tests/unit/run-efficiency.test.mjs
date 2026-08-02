import test from "node:test";
import assert from "node:assert/strict";

import {
  RunEfficiencyGuard,
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
