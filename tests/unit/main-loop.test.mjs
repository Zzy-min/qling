import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  applyProviderUsage,
  distillSuccessfulBashPractices,
  logTurnTelemetry,
  runInnerIterationLoop,
  runOuterAgentLoop,
} from "../../dist/agent/main-loop.js";
import { ExecutionEventBus } from "../../dist/execution/event-bus.js";
import { RecoveryController } from "../../dist/execution/recovery-controller.js";
import { ContextCompactor } from "../../dist/context-compactor.js";
import {
  canStartBudgetedTask,
  estimateModelCostCny,
  resolveCostBudgetSignal,
} from "../../dist/cost-budget.js";

test("cost budget uses conservative cache-miss CNY prices", () => {
  assert.equal(
    estimateModelCostCny(
      { promptTokens: 1_000_000, completionTokens: 500_000 },
      { inputPerMillion: 1, outputPerMillion: 2 }
    ),
    2
  );
  assert.deepEqual(
    resolveCostBudgetSignal(
      { promptTokens: 2_000_000, completionTokens: 1_000_000 },
      {
        QLING_COST_INPUT_CNY_PER_MILLION: "1",
        QLING_COST_OUTPUT_CNY_PER_MILLION: "2",
        QLING_RUN_MAX_COST_CNY: "4",
      }
    ),
    { estimatedCostCny: 4, maxCostCny: 4, exhausted: true }
  );
  assert.equal(canStartBudgetedTask(45, 4, 50), true);
  assert.equal(canStartBudgetedTask(47, 4, 50), false);
});

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
  assert.throws(() => recovery.getRecoveryState(), /recovery run has not started/);
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

test("cost budget pauses before another model call without appending a dangling tool call", async () => {
  const previous = process.env.QLING_RUN_MAX_COST_CNY;
  process.env.QLING_RUN_MAX_COST_CNY = "4";
  const bus = new ExecutionEventBus();
  bus.startRun({ runId: "run-cost", sessionId: "cost-session" });
  const recovery = new RecoveryController();
  recovery.startRun({ runId: "run-cost", sessionId: "cost-session", originalTask: "expensive task" });
  let chatCalled = false;
  const messages = [{ role: "user", content: "expensive task" }];
  try {
    const outcome = await runInnerIterationLoop({
      messages,
      turnCount: 0,
      sessionId: "cost-session",
      maxIterations: 2,
      toolRepeatLimit: 2,
      parseRetries: 0,
      verificationCommand: null,
      counters: {
        sessionTokens: 4_000_000,
        sessionPromptTokens: 4_000_000,
        sessionCompletionTokens: 0,
        tokenUsageSource: "provider",
      },
      compactionCount: 0,
      toolCallTotal: 0,
      toolFailureTotal: 0,
      retryCountTotal: 0,
      loggingFormat: "json",
      activeRunId: "run-cost",
      compactor: new ContextCompactor(10_000_000, "test"),
      pipeline: {},
      tools: [],
      guardConfig: { enabled: false },
      channel: null,
      approvalGate: {},
      knowledgeAdapter: {},
      memoryStore: {},
      workspaceDir: process.cwd(),
      workflowRuntime: {},
      executionEventBus: bus,
      recoveryController: recovery,
      verifier: {},
      buildSystemPrompt: async () => "system",
      chat: async () => { chatCalled = true; return { content: "must not run" }; },
      emit() {},
      runVerificationCommand: async () => ({ code: 0, stdout: "", stderr: "" }),
      getRecoveryState: () => recovery.getRecoveryState(),
      reflectiveThink: async () => ({ decision: "proceed", reason: "" }),
      checkAutoDream: async () => {},
    });
    assert.equal(outcome.status, "paused");
    assert.equal(chatCalled, false);
    assert.equal(messages.length, 1);
    assert.equal(recovery.getRecoveryState().status, "paused");
  } finally {
    if (previous === undefined) delete process.env.QLING_RUN_MAX_COST_CNY;
    else process.env.QLING_RUN_MAX_COST_CNY = previous;
  }
});

test("inner loop distinguishes changed failures and redirects repeated actions without pausing", async () => {
  const bus = new ExecutionEventBus();
  const events = [];
  bus.subscribe((event) => events.push(event));
  bus.startRun({ runId: "run-efficient", sessionId: "efficient-session" });
  const recovery = new RecoveryController();
  recovery.startRun({
    runId: "run-efficient",
    sessionId: "efficient-session",
    originalTask: "diagnose",
  });
  let chatCalls = 0;
  const host = {
    messages: [{ role: "user", content: "diagnose" }],
    turnCount: 0,
    sessionId: "efficient-session",
    maxIterations: 5,
    toolRepeatLimit: 6,
    parseRetries: 0,
    verificationCommand: null,
    counters: {
      sessionTokens: 0,
      sessionPromptTokens: 0,
      sessionCompletionTokens: 0,
      tokenUsageSource: "unknown",
    },
    compactionCount: 0,
    toolCallTotal: 0,
    toolFailureTotal: 0,
    retryCountTotal: 0,
    loggingFormat: "json",
    activeRunId: "run-efficient",
    compactor: new ContextCompactor(1_000_000, "test"),
    pipeline: {
      execute: async (call) => ({
        tool_call_id: call.id,
        output: `Command failed at C:\\repo\\probe${chatCalls}.ps1 exit ${chatCalls}`,
        is_error: true,
        error: { code: "TOOL_ERROR", category: "runtime", message: "Command failed" },
      }),
    },
    tools: [],
    guardConfig: { enabled: false },
    channel: null,
    approvalGate: {},
    knowledgeAdapter: {
      onToolCall() {},
      onToolResult() {},
      onAssistantMessage() {},
      async onTurnEnd() {},
    },
    memoryStore: {
      link() {},
      addConversationTurn() {},
      addPractice() {},
    },
    workspaceDir: process.cwd(),
    workflowRuntime: {},
    executionEventBus: bus,
    recoveryController: recovery,
    verifier: {},
    buildSystemPrompt: async () => "system",
    chat: async () => {
      chatCalls++;
      if (chatCalls === 4) {
        return { content: "diagnosis complete", tool_calls: [] };
      }
      const probe = chatCalls === 3 ? 2 : chatCalls;
      return {
        content: "",
        tool_calls: [{
          id: `bash-${chatCalls}`,
          type: "function",
          function: {
            name: "bash",
            arguments: JSON.stringify({ cmd: `powershell probe${probe}.ps1` }),
          },
        }],
      };
    },
    emit() {},
    runVerificationCommand: async () => ({ code: 0, stdout: "", stderr: "" }),
    getRecoveryState: () => {
      try {
        return recovery.getRecoveryState();
      } catch {
        return null;
      }
    },
    reflectiveThink: async () => ({ decision: "proceed", reason: "" }),
    checkAutoDream: async () => {},
  };

  const outcome = await runInnerIterationLoop(host);
  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.text, "diagnosis complete");
  assert.equal(chatCalls, 4);
  assert.equal(host.toolFailureTotal, 3);
  const guardEvents = events.filter((event) => event.type === "efficiency_guard");
  assert.equal(guardEvents.length, 1);
  assert.equal(guardEvents[0].status, "recovering");
  assert.equal(guardEvents[0].recoveryAction, "change_strategy");
  assert.match(
    host.messages.find((message) => message.synthetic_reason === "efficiency_recovery")?.content ?? "",
    /不得原样重复/
  );
});

test("inner loop exposes successful file side effects to the next model turn", async () => {
  const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "qling-ledger-"));
  try {
    const bus = new ExecutionEventBus();
    bus.startRun({ runId: "run-ledger", sessionId: "ledger-session" });
    const recovery = new RecoveryController();
    recovery.startRun({
      runId: "run-ledger",
      sessionId: "ledger-session",
      originalTask: "write a file",
    });
    let chatCalls = 0;
    const messages = [{ role: "user", content: "write a file" }];
    const host = {
      messages,
      turnCount: 0,
      sessionId: "ledger-session",
      maxIterations: 3,
      toolRepeatLimit: 6,
      parseRetries: 0,
      verificationCommand: null,
      counters: {
        sessionTokens: 0,
        sessionPromptTokens: 0,
        sessionCompletionTokens: 0,
        tokenUsageSource: "unknown",
      },
      compactionCount: 0,
      toolCallTotal: 0,
      toolFailureTotal: 0,
      retryCountTotal: 0,
      loggingFormat: "json",
      activeRunId: "run-ledger",
      compactor: new ContextCompactor(1_000_000, "test"),
      pipeline: {
        execute: async (call) => {
          writeFileSync(path.join(workspaceDir, String(call.arguments.path)), "hello");
          return { tool_call_id: call.id, output: "written", is_error: false };
        },
      },
      tools: [],
      guardConfig: { enabled: false },
      channel: null,
      approvalGate: {},
      knowledgeAdapter: {
        onToolCall() {},
        onToolResult() {},
        onAssistantMessage() {},
        async onTurnEnd() {},
      },
      memoryStore: {
        link() {},
        addConversationTurn() {},
        addPractice() {},
      },
      workspaceDir,
      workflowRuntime: {},
      executionEventBus: bus,
      recoveryController: recovery,
      verifier: {},
      buildSystemPrompt: async () => "system",
      chat: async () => {
        chatCalls++;
        if (chatCalls === 1) {
          return {
            content: "",
            tool_calls: [{
              id: "write-ledger",
              type: "function",
              function: {
                name: "write",
                arguments: JSON.stringify({ path: "created.txt", content: "hello" }),
              },
            }],
          };
        }
        const ledger = messages.find(
          (message) => message.synthetic_reason === "run_side_effects"
        );
        assert.match(ledger?.content ?? "", /created\.txt.*创建/);
        return { content: "done" };
      },
      emit() {},
      runVerificationCommand: async () => ({ code: 0, stdout: "", stderr: "" }),
      getRecoveryState: () => recovery.getRecoveryState(),
      reflectiveThink: async () => ({ decision: "proceed", reason: "" }),
      checkAutoDream: async () => {},
    };

    const outcome = await runInnerIterationLoop(host);
    assert.equal(outcome.status, "succeeded");
    assert.equal(chatCalls, 2);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});
