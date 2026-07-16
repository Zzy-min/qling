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

test("outer loop treats a cooperative cancel as terminal instead of recovery", async () => {
  const bus = new ExecutionEventBus();
  const events = [];
  bus.subscribe((event) => events.push(event));
  let activeRun = null;
  await assert.rejects(
    runOuterAgentLoop({
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
      executeInner: async () => "should not be returned",
      isCanceled: () => true,
    }),
    (error) => error?.name === "AgentRunCanceledError",
  );
  assert.equal(activeRun, null);
  assert.equal(events.at(-1).type, "run_completed");
  assert.equal(events.at(-1).status, "canceled");
  assert.equal(events.some((event) => event.type === "failure"), false);
});
