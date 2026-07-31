import test from "node:test";
import assert from "node:assert/strict";

import {
  RunEfficiencyGuard,
  normalizeFailureFingerprint,
} from "../../dist/agent/run-efficiency.js";
import { buildMandatoryRulesReference } from "../../dist/agent/system-prompt.js";

test("failure fingerprints ignore volatile commands, paths and numbers", () => {
  const first = normalizeFailureFingerprint({
    tool: "bash",
    code: "TOOL_ERROR",
    category: "runtime",
    message: "Command failed at C:\\Users\\Lenovo\\probe1.ps1 exit 1",
  });
  const second = normalizeFailureFingerprint({
    tool: "bash",
    code: "TOOL_ERROR",
    category: "runtime",
    message: "Command failed at C:\\Users\\Lenovo\\probe2.ps1 exit 2",
  });
  assert.equal(first, second);
});

test("efficiency guard pauses after two same-family failures despite changed tool args", () => {
  const guard = new RunEfficiencyGuard();
  assert.equal(
    guard.recordTools([
      { tool: "bash", failed: true, failureFingerprint: "bash:runtime:command-failed" },
    ]),
    null
  );
  assert.match(
    guard.recordTools([
      { tool: "bash", failed: true, failureFingerprint: "bash:runtime:command-failed" },
    ])?.reason ?? "",
    /同类失败/
  );
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
  assert.match(
    guard.recordTools([{ tool: "c", failed: true, failureFingerprint: "3" }])?.reason ?? "",
    /失败预算/
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
