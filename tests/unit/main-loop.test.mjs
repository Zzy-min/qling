import test from "node:test";
import assert from "node:assert/strict";

import {
  applyProviderUsage,
  distillSuccessfulBashPractices,
  logTurnTelemetry,
  runOuterAgentLoop,
} from "../../dist/agent/main-loop.js";
import { ExecutionEventBus } from "../../dist/execution/event-bus.js";
import { RecoveryController } from "../../dist/execution/recovery-controller.js";

test("applyProviderUsage only accumulates official usage", () => {
  const base = {
    sessionTokens: 0,
    sessionPromptTokens: 0,
    sessionCompletionTokens: 0,
    tokenUsageSource: "unknown",
  };
  const next = applyProviderUsage(base, {
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
  });
  assert.equal(next.sessionTokens, 15);
  assert.equal(next.tokenUsageSource, "provider");
  const same = applyProviderUsage(base, undefined);
  assert.equal(same.tokenUsageSource, "unknown");
});

test("logTurnTelemetry updates totals", () => {
  const totals = logTurnTelemetry(
    { turn: 2, toolCalls: 4, toolFailures: 1 },
    {
      toolCallTotal: 2,
      toolFailureTotal: 0,
      compactionCount: 1,
      retryCountTotal: 0,
      format: "json",
    }
  );
  assert.equal(totals.toolCallTotal, 6);
  assert.equal(totals.toolFailureTotal, 1);
});

test("distillSuccessfulBashPractices records practices for successful bash", () => {
  const practices = [];
  const memoryStore = {
    addPractice: (task, cmds, files) => {
      practices.push({ task, cmds, files });
    },
  };
  distillSuccessfulBashPractices(
    [
      {
        call: { id: "1", name: "bash", arguments: { cmd: "npm test", path: "pkg" } },
      },
    ],
    [{ role: "user", content: "run tests please" }],
    memoryStore
  );
  assert.equal(practices.length, 1);
  assert.deepEqual(practices[0].cmds, ["npm test"]);
});

test("outer loop returns a typed canceled outcome instead of recovery", async () => {
  const bus = new ExecutionEventBus();
  const events = [];
  bus.subscribe((event) => events.push(event));
  let activeRun = null;
  const outcome = await runOuterAgentLoop({
      sessionId: "cancel-session",
      activeRun,
      messages: [{ role: "user", content: "cancel me" }],
      executionEventBus: bus,
      recoveryController: new RecoveryController(),
      emit: () => {},
      getRecoveryState: () => null,
      formatRecoveryPause: () => "paused",
      applyRecoveryStrategy: async () => {},
      setActiveRun: (run) => { activeRun = run; },
      executeInner: async () => ({ status: "succeeded", text: "should not be returned" }),
      isCanceled: () => true,
    });
  assert.equal(outcome.status, "canceled");
  assert.equal(activeRun, null);
  assert.equal(events.at(-1).type, "run_completed");
  assert.equal(events.at(-1).status, "canceled");
  assert.equal(events.some((event) => event.type === "failure"), false);
});

test("outer loop never promotes exhausted or paused inner outcomes to succeeded", async () => {
  for (const status of ["exhausted", "paused"]) {
    const bus = new ExecutionEventBus();
    const events = [];
    bus.subscribe((event) => events.push(event));
    let activeRun = null;
    const recovery = new RecoveryController();
    if (status === "paused") {
      recovery.startRun({ runId: "existing", sessionId: "s", originalTask: "task" });
      recovery.recordFailure({ category: "permission_denied", message: "denied" }, {});
    }
    const outcome = await runOuterAgentLoop({
      sessionId: "s",
      activeRun,
      messages: [{ role: "user", content: "task" }],
      executionEventBus: bus,
      recoveryController: recovery,
      emit: () => {},
      getRecoveryState: () => status === "paused" ? { status: "paused" } : null,
      formatRecoveryPause: () => "paused",
      applyRecoveryStrategy: async () => {},
      setActiveRun: (run) => { activeRun = run; },
      executeInner: async () => ({ status, text: `${status} text`, iterations: 2 }),
      isCanceled: () => false,
    });
    assert.equal(outcome.status, status);
    assert.equal(events.some((event) => event.type === "run_completed" && event.status === "succeeded"), false);
  }
});

test("resumed run reuses its runId and registers it with a fresh event bus", async () => {
  const bus = new ExecutionEventBus();
  const events = [];
  bus.subscribe((event) => events.push(event));
  const recovery = new RecoveryController();
  recovery.startRun({ runId: "run-original", sessionId: "s", originalTask: "task" });
  recovery.recordFailure({ category: "permission_denied", message: "denied" }, {});
  recovery.applyAction("retry");
  let activeRun = {
    runId: "run-original",
    sessionId: "s",
    originalTask: "task",
    startedAt: 1,
  };

  const outcome = await runOuterAgentLoop({
    sessionId: "s",
    activeRun,
    messages: [{ role: "user", content: "task" }],
    executionEventBus: bus,
    recoveryController: recovery,
    emit: () => {},
    getRecoveryState: () => { try { return recovery.getRecoveryState(); } catch { return null; } },
    formatRecoveryPause: () => "paused",
    applyRecoveryStrategy: async () => {},
    setActiveRun: (run) => { activeRun = run; },
    executeInner: async () => ({ status: "succeeded", text: "done" }),
    isCanceled: () => false,
  });

  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.runId, "run-original");
  assert.deepEqual(
    events.filter((event) => event.type === "run_started" || event.type === "run_completed")
      .map((event) => [event.type, event.runId, event.status]),
    [
      ["run_started", "run-original", "running"],
      ["run_completed", "run-original", "succeeded"],
    ]
  );
});

test("provider retry budget is the only retry layer and honors Retry-After", async () => {
  const bus = new ExecutionEventBus();
  const recovery = new RecoveryController();
  const sleeps = [];
  let calls = 0;
  let retries = 0;
  let activeRun = null;
  const outcome = await runOuterAgentLoop({
    sessionId: "provider-session",
    activeRun,
    messages: [{ role: "user", content: "retry provider" }],
    executionEventBus: bus,
    recoveryController: recovery,
    emit: () => {},
    getRecoveryState: () => { try { return recovery.getRecoveryState(); } catch { return null; } },
    formatRecoveryPause: () => "paused",
    applyRecoveryStrategy: async () => {},
    setActiveRun: (run) => { activeRun = run; },
    executeInner: async () => {
      calls++;
      const error = new Error("gateway timeout");
      error.status = 504;
      error.retryAfterMs = 1500;
      throw error;
    },
    providerRetryLimit: 2,
    sleep: async (delay) => { sleeps.push(delay); },
    onProviderRetry: () => { retries++; },
  });
  assert.equal(outcome.status, "failed");
  assert.equal(calls, 3);
  assert.equal(retries, 2);
  assert.deepEqual(sleeps, [1500, 1500]);
});

test("operator pause keeps the active run resumable instead of reporting cancellation", async () => {
  const bus = new ExecutionEventBus();
  const recovery = new RecoveryController();
  let activeRun = null;
  const outcome = await runOuterAgentLoop({
    sessionId: "pause-session",
    activeRun,
    messages: [{ role: "user", content: "pause this" }],
    executionEventBus: bus,
    recoveryController: recovery,
    emit: () => {},
    getRecoveryState: () => { try { return recovery.getRecoveryState(); } catch { return null; } },
    formatRecoveryPause: () => "paused by operator",
    applyRecoveryStrategy: async () => {},
    setActiveRun: (run) => { activeRun = run; },
    executeInner: async () => {
      recovery.pauseActiveRun();
      const error = new Error("request canceled");
      error.name = "AgentRunCanceledError";
      throw error;
    },
    isCanceled: () => true,
  });
  assert.equal(outcome.status, "paused");
  assert.equal(outcome.runId, activeRun.runId);
  assert.equal(recovery.getRecoveryState().status, "paused");
});
