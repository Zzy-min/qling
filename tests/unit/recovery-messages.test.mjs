import test from "node:test";
import assert from "node:assert/strict";

import {
  buildVerificationFailureUserMessage,
  formatRecoveryInstruction,
  formatRecoveryPause,
} from "../../dist/execution/recovery-messages.js";

test("formatRecoveryInstruction includes category and strategy guidance", () => {
  const text = formatRecoveryInstruction(
    { category: "verification_failed", message: "tests failed" },
    "targeted_verification_repair"
  );
  assert.match(text, /verification_failed/);
  assert.match(text, /targeted_verification_repair/);
  assert.match(text, /失败测试集合/);
});

test("formatRecoveryPause includes evidence and recovery actions", () => {
  const text = formatRecoveryPause({
    reason: "budget",
    next: "strategy_budget_exhausted",
    verificationStagesSummary: "configured=npm test",
    state: {
      runId: "r1",
      sessionId: "s1",
      originalTask: "fix",
      status: "paused",
      strategyAttempts: 2,
      remainingStrategyAttempts: 2,
      currentStrategy: "narrow_verification_scope",
      attemptedStrategies: ["targeted_verification_repair"],
      lastFailure: { category: "verification_failed", fingerprint: "fp", message: "x" },
      lastProgress: { changedFiles: ["a.ts"] },
    },
  });
  assert.match(text, /执行已暂停/);
  assert.match(text, /narrow_verification_scope/);
  assert.match(text, /a\.ts/);
  assert.match(text, /\/recover/);
});

test("buildVerificationFailureUserMessage is structured", () => {
  const text = buildVerificationFailureUserMessage({
    failedStage: "configured",
    failedCommand: "npm test",
    failingTests: ["t1"],
    changedFiles: ["x.ts"],
    fingerprint: "abc",
    attemptedStrategies: ["targeted_verification_repair"],
    strategy: "narrow_verification_scope",
    stdout: "out",
    stderr: "err",
    instructionBody: "only fix failing tests",
  });
  assert.match(text, /定向验证失败/);
  assert.match(text, /npm test/);
  assert.match(text, /x\.ts/);
  assert.match(text, /only fix failing tests/);
});
