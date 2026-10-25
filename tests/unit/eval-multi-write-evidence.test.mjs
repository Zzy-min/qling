import test from "node:test";
import assert from "node:assert/strict";

test("multi-write evaluation preserves agent usage when the independent verifier fails", async () => {
  const { summarizeMultiWriteEvaluation } = await import("../../scripts/lib/multi-write-evidence.mjs");
  const summary = summarizeMultiWriteEvaluation({
    durationMs: 10,
    agentResults: [
      { is_error: false, meta: { integratedFiles: ["src/math.js"], taskId: "math", usageSnapshot: { totalTokens: 12 } } },
      { is_error: false, meta: { integratedFiles: ["src/text.js"], taskId: "text", usageSnapshot: { totalTokens: 15 } } },
    ],
    changed: ["src/text.js"],
    mathSource: "export const add = (a, b) => a - b;",
    textSource: "export const slug = (s) => s.toLowerCase();",
    verifier: { ok: false, stdout: "# fail 1", error: "add failed" },
  });
  assert.equal(summary.status, "fail");
  assert.equal(summary.agents[0].usage.totalTokens, 12);
  assert.equal(summary.agents[1].usage.totalTokens, 15);
  assert.equal(summary.verifier.ok, false);
  assert.equal(summary.verifier.error, "add failed");
});

test("failed subtask preserves partial model usage", async () => {
  const { subtaskErrorWithUsage } = await import("../../dist/tools/subtask.js");
  const result = subtaskErrorWithUsage(
    "SUBTASK_FAILED",
    "verification failed",
    { promptTokens: 120, completionTokens: 8, totalTokens: 128 },
    true,
  );
  assert.equal(result.is_error, true);
  assert.deepEqual(result.meta?.usageSnapshot, {
    promptTokens: 120,
    completionTokens: 8,
    totalTokens: 128,
  });
  assert.equal(result.meta?.usageIsIncomplete, true);
});
