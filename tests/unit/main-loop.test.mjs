import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
import { UsageLedger } from "../../dist/usage-ledger.js";
import { inspectProjectProfile } from "../../dist/runtime/project-profile.js";
import { RunCheckpointStore } from "../../dist/runtime/run-checkpoint.js";
import { getBackgroundTaskRegistry, resetBackgroundTaskRegistryForTests } from "../../dist/runtime/background-tasks.js";
import { runBgReconcile } from "../../dist/tools/bg-task.js";
import { SessionLease } from "../../dist/runtime/session-lease.js";
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

test("coding evaluation cannot complete without a workspace mutation", async () => {
  const bus = new ExecutionEventBus();
  bus.startRun({ runId: "run-require-mutation", sessionId: "require-mutation-session" });
  const recovery = new RecoveryController();
  recovery.startRun({
    runId: "run-require-mutation",
    sessionId: "require-mutation-session",
    originalTask: "fix source",
  });
  const messages = [{ role: "user", content: "fix source" }];
  let chatCalls = 0;
  const outcome = await runInnerIterationLoop({
    messages,
    turnCount: 0,
    sessionId: "require-mutation-session",
    maxIterations: 2,
    toolRepeatLimit: 2,
    parseRetries: 0,
    verificationCommand: null,
    requireWorkspaceMutation: true,
    counters: { sessionTokens: 0, sessionPromptTokens: 0, sessionCompletionTokens: 0, tokenUsageSource: "unknown" },
    compactionCount: 0,
    toolCallTotal: 0,
    toolFailureTotal: 0,
    retryCountTotal: 0,
    loggingFormat: "json",
    activeRunId: "run-require-mutation",
    compactor: new ContextCompactor(1_000_000, "test"),
    pipeline: {},
    tools: [],
    guardConfig: { enabled: false },
    channel: null,
    approvalGate: {},
    knowledgeAdapter: { onAssistantMessage() {}, async onTurnEnd() {} },
    memoryStore: {},
    workspaceDir: process.cwd(),
    workflowRuntime: {},
    executionEventBus: bus,
    recoveryController: recovery,
    verifier: {},
    buildSystemPrompt: async () => "system",
    chat: async () => { chatCalls++; return { content: "done", tool_calls: [] }; },
    emit() {},
    runVerificationCommand: async () => ({ code: 0, stdout: "", stderr: "" }),
    getRecoveryState: () => recovery.getRecoveryState(),
    reflectiveThink: async () => ({ decision: "proceed", reason: "" }),
    checkAutoDream: async () => {},
  });

  assert.equal(outcome.status, "exhausted");
  assert.equal(chatCalls, 2);
  assert.match(
    messages.find((message) => message.synthetic_key === "workspace-mutation-required-v1")?.content ?? "",
    /必须直接修改目标源码或配置文件/,
  );
});

test("coding evaluation does not treat an unknown-outcome sentinel as a deliverable mutation", async () => {
  const bus = new ExecutionEventBus();
  bus.startRun({ runId: "run-sentinel-mutation", sessionId: "sentinel-mutation-session" });
  const recovery = new RecoveryController();
  recovery.startRun({ runId: "run-sentinel-mutation", sessionId: "sentinel-mutation-session", originalTask: "fix source" });
  const messages = [{ role: "user", content: "fix source" }];
  const outcome = await runInnerIterationLoop({
    messages, turnCount: 0, sessionId: "sentinel-mutation-session", maxIterations: 1,
    toolRepeatLimit: 2, parseRetries: 0, verificationCommand: null, requireWorkspaceMutation: true,
    initialProgressState: {
      phase: "repair", sequence: 1, activeMutationId: "unknown-side-effect",
      activeMutationPaths: ["<workspace-capture-unavailable>"], latestVerificationVerdict: "pass",
    },
    counters: { sessionTokens: 0, sessionPromptTokens: 0, sessionCompletionTokens: 0, tokenUsageSource: "unknown" },
    compactionCount: 0, toolCallTotal: 0, toolFailureTotal: 0, retryCountTotal: 0,
    loggingFormat: "json", activeRunId: "run-sentinel-mutation", compactor: new ContextCompactor(1_000_000, "test"),
    pipeline: {}, tools: [], guardConfig: { enabled: false }, channel: null, approvalGate: {},
    knowledgeAdapter: { onAssistantMessage() {}, async onTurnEnd() {} }, memoryStore: {}, workspaceDir: process.cwd(),
    workflowRuntime: {}, executionEventBus: bus, recoveryController: recovery, verifier: {},
    buildSystemPrompt: async () => "system", chat: async () => ({ content: "done", tool_calls: [] }), emit() {},
    runVerificationCommand: async () => ({ code: 0, stdout: "", stderr: "" }),
    getRecoveryState: () => recovery.getRecoveryState(), reflectiveThink: async () => ({ decision: "proceed", reason: "" }),
    checkAutoDream: async () => {},
  });
  assert.equal(outcome.status, "exhausted");
  assert.ok(messages.some((message) => message.synthetic_key === "workspace-mutation-required-v1"));
});

test("inner loop advises on repeated actions without blocking execution", async () => {
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
  let pipelineCalls = 0;
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
      execute: async (call) => {
        pipelineCalls++;
        return {
          tool_call_id: call.id,
          output: `Command failed at C:\\repo\\probe${chatCalls}.ps1 exit ${chatCalls}`,
          is_error: true,
          error: { code: "TOOL_ERROR", category: "runtime", message: "Command failed" },
        };
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
      return {
        content: "",
        tool_calls: [{
          id: `bash-${chatCalls}`,
          type: "function",
          function: {
            name: "bash",
            arguments: JSON.stringify({ cmd: "powershell probe.ps1" }),
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
  assert.equal(pipelineCalls, 3, "efficiency advice must not deny the third execution");
  assert.equal(host.toolFailureTotal, 3, "all three real execution failures remain observable");
  const guardEvents = events.filter((event) => event.type === "efficiency_guard");
  assert.equal(guardEvents.length, 1);
  assert.equal(guardEvents[0].status, "recovering");
  assert.equal(guardEvents[0].recoveryAction, "correct_parameters");
  assert.match(
    host.messages.find((message) => message.synthetic_reason === "efficiency_recovery")?.content ?? "",
    /不得原样重试/
  );
});

test("inner loop exposes file side effects, allows one degraded-environment audit, then pauses", async () => {
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
      projectProfile: {
        revision: "r", dirtyFingerprint: "d", parserVersion: "test",
        ecosystems: ["python"], manifests: ["pyproject.toml"], lockfiles: [], testCommands: [],
        runtime: "native", environmentStatus: "degraded",
        blockers: ["Python test bootstrap modules unavailable in native: hypothesis"],
      },
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
        const audit = messages.find(
          (message) => message.synthetic_reason === "verification_audit"
        );
        assert.match(audit?.content ?? "", /post-mutation audit|反向路径/iu);
        return { content: "done" };
      },
      emit() {},
      runVerificationCommand: async () => ({ code: 0, stdout: "", stderr: "" }),
      getRecoveryState: () => recovery.getRecoveryState(),
      reflectiveThink: async () => ({ decision: "proceed", reason: "" }),
      checkAutoDream: async () => {},
    };

    const outcome = await runInnerIterationLoop(host);
    assert.equal(outcome.status, "paused");
    assert.match(outcome.text, /^验证环境未就绪/);
    assert.match(outcome.text, /尚无可用的确定性验证器/);
    assert.equal(chatCalls, 2);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("inner loop cannot report success while configured verification is failing", async () => {
  const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "qling-verify-gate-"));
  try {
    const bus = new ExecutionEventBus();
    bus.startRun({ runId: "run-verify-gate", sessionId: "verify-gate-session" });
    const recovery = new RecoveryController();
    recovery.startRun({
      runId: "run-verify-gate",
      sessionId: "verify-gate-session",
      originalTask: "write and verify",
    });
    let chatCalls = 0;
    const host = {
      messages: [{ role: "user", content: "write and verify" }],
      turnCount: 0,
      sessionId: "verify-gate-session",
      maxIterations: 3,
      toolRepeatLimit: 6,
      parseRetries: 0,
      verificationCommand: "npm test",
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
      activeRunId: "run-verify-gate",
      compactor: new ContextCompactor(1_000_000, "test"),
      pipeline: {
        execute: async (call) => {
          writeFileSync(path.join(workspaceDir, String(call.arguments.path)), "broken");
          return { tool_call_id: call.id, output: "written", is_error: false };
        },
      },
      tools: [],
      guardConfig: { enabled: false },
      channel: null,
      approvalGate: {},
      knowledgeAdapter: {
        onToolCall() {}, onToolResult() {}, onAssistantMessage() {}, async onTurnEnd() {},
      },
      memoryStore: {
        link() {}, addConversationTurn() {}, addPractice() {},
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
              id: "write-before-failure",
              type: "function",
              function: { name: "write", arguments: JSON.stringify({ path: "broken.txt", content: "broken" }) },
            }],
          };
        }
        return { content: "done", tool_calls: [] };
      },
      emit() {},
      runVerificationCommand: async () => ({ code: 1, stdout: "1 failed", stderr: "" }),
      getRecoveryState: () => recovery.getRecoveryState(),
      reflectiveThink: async () => ({ decision: "proceed", reason: "" }),
      checkAutoDream: async () => {},
    };

    const outcome = await runInnerIterationLoop(host);
    assert.notEqual(outcome.status, "succeeded");
    assert.ok(host.messages.some((message) => message.synthetic_reason === "efficiency_recovery"));
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("inner loop detects an indirect bash mutation and runs the nearest project verifier", async () => {
  const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "qling-bash-verify-"));
  const previousReliability = process.env.QLING_FEATURES_RELIABILITY_V2;
  try {
    process.env.QLING_FEATURES_RELIABILITY_V2 = "true";
    writeFileSync(path.join(workspaceDir, "module.py"), "VALUE = 1\n");
    writeFileSync(path.join(workspaceDir, "test_module.py"), "def test_value():\n    assert True\n");
    execFileSync("git", ["init"], { cwd: workspaceDir, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "qling-test@example.invalid"], { cwd: workspaceDir });
    execFileSync("git", ["config", "user.name", "Qling Test"], { cwd: workspaceDir });
    execFileSync("git", ["add", "."], { cwd: workspaceDir });
    execFileSync("git", ["commit", "-m", "baseline"], { cwd: workspaceDir, stdio: "ignore" });

    const bus = new ExecutionEventBus();
    bus.startRun({ runId: "run-bash-verify", sessionId: "bash-verify-session" });
    const recovery = new RecoveryController();
    recovery.startRun({
      runId: "run-bash-verify",
      sessionId: "bash-verify-session",
      originalTask: "edit with bash and verify",
    });
    const verificationCalls = [];
    let chatCalls = 0;
    const host = {
      messages: [{ role: "user", content: "edit module.py with bash" }],
      turnCount: 0,
      sessionId: "bash-verify-session",
      maxIterations: 3,
      toolRepeatLimit: 6,
      parseRetries: 0,
      verificationCommand: null,
      deterministicVerificationAvailable: true,
      projectProfile: {
        revision: "baseline",
        dirtyFingerprint: "clean",
        parserVersion: "test",
        ecosystems: ["python"],
        manifests: ["pyproject.toml"],
        lockfiles: [],
        testCommands: [{
          id: "project:python:pytest",
          stage: "targeted",
          command: "python -m pytest",
          reason: "test fixture",
        }],
        runtime: "native",
        environmentStatus: "ready",
        blockers: [],
      },
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
      activeRunId: "run-bash-verify",
      compactor: new ContextCompactor(1_000_000, "test"),
      pipeline: {
        execute: async (call) => {
          writeFileSync(path.join(workspaceDir, "module.py"), "VALUE = 2\n");
          return { tool_call_id: call.id, output: "updated module.py", is_error: false };
        },
      },
      tools: [],
      guardConfig: { enabled: false },
      channel: null,
      approvalGate: {},
      knowledgeAdapter: {
        onToolCall() {}, onToolResult() {}, onAssistantMessage() {}, async onTurnEnd() {},
      },
      memoryStore: {
        link() {}, addConversationTurn() {}, addPractice() {},
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
              id: "bash-indirect-write",
              type: "function",
              function: { name: "bash", arguments: JSON.stringify({ cmd: "update module.py" }) },
            }],
          };
        }
        return { content: "verified", tool_calls: [] };
      },
      emit() {},
      runVerificationCommand: async (command, runtime) => {
        verificationCalls.push({ command, runtime });
        return { code: 0, stdout: "1 passed", stderr: "" };
      },
      getRecoveryState: () => recovery.getRecoveryState(),
      reflectiveThink: async () => ({ decision: "proceed", reason: "" }),
      checkAutoDream: async () => {},
    };

    const outcome = await runInnerIterationLoop(host);
    assert.equal(outcome.status, "succeeded");
    assert.equal(outcome.text, "verified");
    assert.equal(chatCalls, 2);
    assert.deepEqual(verificationCalls, [{
      command: "python -m pytest test_module.py",
      runtime: "native",
    }]);
    assert.match(host.messages.find((message) => message.synthetic_reason === "run_side_effects")?.content ?? "", /module\.py/);
  } finally {
    if (previousReliability === undefined) delete process.env.QLING_FEATURES_RELIABILITY_V2;
    else process.env.QLING_FEATURES_RELIABILITY_V2 = previousReliability;
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("unknown background outcome exits through approval, durable checkpoint, full verifier, and success", async () => {
  const workspaceDir = mkdtempSync(path.join(os.tmpdir(), "qling-bg-e2e-workspace-"));
  const stateDir = mkdtempSync(path.join(os.tmpdir(), "qling-bg-e2e-state-"));
  const taskId = "bg_unknown_e2e";
  const runId = "run-bg-e2e";
  const sessionId = "session-bg-e2e";
  const previousReliability = process.env.QLING_FEATURES_RELIABILITY_V2;
  const previousStateDir = process.env.QLING_FILE_STATE_DIR;
  const previousWorkspaceDir = process.env.QLING_WORKSPACE_DIR;
  process.env.QLING_FEATURES_RELIABILITY_V2 = "true";
  process.env.QLING_FILE_STATE_DIR = stateDir;
  process.env.QLING_WORKSPACE_DIR = workspaceDir;
  let lease;
  try {
    lease = SessionLease.acquire({ stateDir, sessionId, workspaceDir });
    writeFileSync(path.join(workspaceDir, "package.json"), JSON.stringify({ scripts: { test: "node -e \"process.exit(0)\"" } }));
    writeFileSync(path.join(workspaceDir, "source.js"), "export const value = 1;\n");
    execFileSync("git", ["init", "-q"], { cwd: workspaceDir });
    execFileSync("git", ["config", "user.email", "eval@example.invalid"], { cwd: workspaceDir });
    execFileSync("git", ["config", "user.name", "Qling Eval"], { cwd: workspaceDir });
    execFileSync("git", ["add", "."], { cwd: workspaceDir });
    execFileSync("git", ["commit", "-qm", "fixture"], { cwd: workspaceDir });
    writeFileSync(path.join(stateDir, "background-tasks.json"), JSON.stringify({
      version: 1,
      tasks: [{ taskId, kind: "shell", status: "unknown_outcome", command: "<redacted>", commandHash: "abcdef", cwd: workspaceDir, ownerWorkspace: workspaceDir, ownerSessionId: sessionId, ownerRunId: runId, createdAt: 1, updatedAt: 1, output: "", maxLifetimeMs: 1000 }],
    }));
    resetBackgroundTaskRegistryForTests();
    const profile = await inspectProjectProfile({ workspaceDir, requestedRuntime: "native" });
    assert.ok(profile.testCommands.some((command) => command.id === "project:node:test"));
    const bus = new ExecutionEventBus();
    bus.startRun({ runId, sessionId });
    const recovery = new RecoveryController();
    recovery.startRun({ runId, sessionId, originalTask: "recover task" });
    const messages = [{ role: "user", content: "继续恢复并验证" }];
    let chatCalls = 0;
    const host = {
      messages, turnCount: 0, sessionId, sessionLeaseToken: lease.token, maxIterations: 3, toolRepeatLimit: 6, parseRetries: 0,
      verificationCommand: null,
      counters: { sessionTokens: 0, sessionPromptTokens: 0, sessionCompletionTokens: 0, tokenUsageSource: "unknown" },
      compactionCount: 0, toolCallTotal: 0, toolFailureTotal: 0, retryCountTotal: 0,
      loggingFormat: "json", activeRunId: runId,
      compactor: new ContextCompactor(1_000_000, "test"),
      pipeline: { execute: async (call, execute) => execute(call) },
      tools: [], guardConfig: { enabled: false }, channel: {}, approvalGate: {},
      knowledgeAdapter: { onToolCall() {}, onToolResult() {}, onAssistantMessage() {}, async onTurnEnd() {} },
      memoryStore: { link() {}, addConversationTurn() {}, addPractice() {} },
      workspaceDir, fileStateDir: stateDir, workflowRuntime: {}, executionEventBus: bus, recoveryController: recovery, verifier: {},
      usageLedger: new UsageLedger(),
      checkpointStore: new RunCheckpointStore({ stateDir, workspaceDir, runId }),
      initialProgressState: { sequence: 0, phase: "repair", pendingSideEffectIds: [taskId] },
      deterministicVerificationAvailable: true,
      projectProfile: profile,
      dispatchTool: async (call) => runBgReconcile(call.arguments),
      buildSystemPrompt: async () => "system",
      chat: async () => {
        chatCalls++;
        if (chatCalls === 1) return { content: "", tool_calls: [{ id: "reconcile-e2e", type: "function", function: { name: "bg_reconcile", arguments: JSON.stringify({ task_id: taskId, confirm_unknown_outcome: true }) } }] };
        return { content: "verified and complete", tool_calls: [] };
      },
      emit() {},
      runVerificationCommand: async () => ({ code: 0, stdout: "pass", stderr: "" }),
      getRecoveryState: () => recovery.getRecoveryState(),
      reflectiveThink: async () => ({ decision: "proceed", reason: "" }),
      checkAutoDream: async () => {},
    };
    const outcome = await runInnerIterationLoop(host);
    assert.equal(outcome.status, "succeeded");
    assert.equal(outcome.text, "verified and complete");
    assert.equal(getBackgroundTaskRegistry().get(taskId)?.status, "acknowledged");
    const checkpoint = await host.checkpointStore.loadLatest();
    assert.equal(checkpoint?.latestVerification?.verdict, "pass");
    assert.equal(checkpoint?.progressState?.pendingSideEffectIds?.length, 0);
    assert.equal(checkpoint?.progressState?.latestVerificationVerdict, "pass");
  } finally {
    resetBackgroundTaskRegistryForTests();
    lease?.release();
    if (previousReliability === undefined) delete process.env.QLING_FEATURES_RELIABILITY_V2; else process.env.QLING_FEATURES_RELIABILITY_V2 = previousReliability;
    if (previousStateDir === undefined) delete process.env.QLING_FILE_STATE_DIR; else process.env.QLING_FILE_STATE_DIR = previousStateDir;
    if (previousWorkspaceDir === undefined) delete process.env.QLING_WORKSPACE_DIR; else process.env.QLING_WORKSPACE_DIR = previousWorkspaceDir;
    rmSync(workspaceDir, { recursive: true, force: true });
    rmSync(stateDir, { recursive: true, force: true });
  }
});
