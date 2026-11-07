import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { runReasoningBenchmark } from "../../dist/eval/reasoning-benchmark.js";

test("offline benchmark discloses unavailable comparisons and counts executed fixture records", async () => {
  const summary = await runReasoningBenchmark();
  assert.equal(summary.scenarioCount, 12);
  assert.equal(summary.metadata.realModelVerification, false);
  assert.equal(summary.metadata.evaluationKind, "offline_scripted_contracts");
  assert.equal(summary.baseline, null);
  assert.equal(summary.baselineMetrics, null);
  assert.equal(summary.deltas, null);
  assert.ok(summary.metadata.baselineUnavailableReason);
  assert.equal(summary.refactoredMetrics.realAgentTaskSuccessRate, null);
  assert.equal(summary.refactoredMetrics.realModelLatencyMs, null);
  assert.equal(summary.observedAcceptance, true);
  for (const scenario of summary.scenarios) {
    assert.equal(scenario.baseline, null);
    assert.equal(scenario.refactored.toolCalls, scenario.trace.toolExecutions.length);
    assert.equal(scenario.refactored.invalidToolCalls,
      scenario.trace.toolExecutions.filter((record) => record.invalidArguments).length);
    assert.equal(scenario.refactored.latencyMs, scenario.trace.elapsedMs);
    assert.ok(scenario.trace.elapsedMs >= 0);
    assert.ok(scenario.criteria.length > 0);
    assert.equal(scenario.observedAcceptance, scenario.criteria.every((criterion) => criterion.passed));
  }
  const falseCompletion = summary.scenarios.find((s) => s.id.startsWith("S10"));
  assert.equal(falseCompletion.executionKind, "production_loop_scripted_model");
  assert.equal(falseCompletion.refactored.toolCalls, 0);
  assert.equal(falseCompletion.trace.toolExecutions.length, 0);
  assert.ok(falseCompletion.trace.scriptedModelCalls >= 2);
  assert.notEqual(falseCompletion.trace.runtimeOutcome.status, "succeeded");
  assert.notEqual(falseCompletion.trace.runtimeOutcome.completionStatus, "completed_verified");
});

test("changing an executed fixture result changes acceptance rather than retaining literal winners", async () => {
  const summary = await runReasoningBenchmark({
    transformToolResult: ({ scenarioId, tool }, result) =>
      scenarioId.startsWith("S01") && tool === "read"
        ? { ...result, output: '{"version":"wrong"}' }
        : result,
  });
  const failed = summary.scenarios.find((s) => s.id.startsWith("S01"));
  assert.equal(failed.observedAcceptance, false);
  assert.equal(summary.observedAcceptance, false);
  assert.ok(summary.refactoredMetrics.componentAcceptanceRate < 1);
  assert.equal(failed.trace.toolExecutions[0].output, '{"version":"wrong"}');
});

test("CLI exits nonzero when an actual fixture fails acceptance", () => {
  const code = `
    import { main } from './scripts/eval-reasoning-verdict.mjs';
    import { runReasoningBenchmark } from './dist/eval/reasoning-benchmark.js';
    process.exitCode = await main(() => runReasoningBenchmark({
      transformToolResult: ({ scenarioId, tool }, result) =>
        scenarioId.startsWith('S01') && tool === 'read'
          ? { ...result, output: '{"version":"wrong"}' } : result,
    }));
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    cwd: new URL("../..", import.meta.url), encoding: "utf8", timeout: 30_000,
  });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 1, child.stderr);
  const summary = JSON.parse(child.stdout);
  assert.equal(summary.observedAcceptance, false);
  assert.match(child.stderr, /S01_simple_single_step/);
});
