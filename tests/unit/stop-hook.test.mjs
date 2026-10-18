import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInnerIterationLoop } from "../../dist/agent/main-loop.js";
import { stopHookMaxContinuations } from "../../dist/hooks/json-hooks.js";
import { ExecutionEventBus } from "../../dist/execution/event-bus.js";
import { RecoveryController } from "../../dist/execution/recovery-controller.js";
import { ContextCompactor } from "../../dist/context-compactor.js";

function hostFor(dir, chat, runStopHook) {
  const bus = new ExecutionEventBus();
  bus.startRun({ runId: "run-stop", sessionId: "stop-session" });
  const recovery = new RecoveryController();
  recovery.startRun({ runId: "run-stop", sessionId: "stop-session", originalTask: "finish" });
  return {
    messages: [{ role: "user", content: "finish" }],
    turnCount: 0,
    sessionId: "stop-session",
    maxIterations: 20,
    toolRepeatLimit: 2,
    parseRetries: 0,
    verificationCommand: null,
    counters: { sessionTokens: 0, sessionPromptTokens: 0, sessionCompletionTokens: 0, tokenUsageSource: "unknown" },
    compactionCount: 0,
    toolCallTotal: 0,
    toolFailureTotal: 0,
    retryCountTotal: 0,
    loggingFormat: "json",
    activeRunId: "run-stop",
    compactor: new ContextCompactor(1_000_000, "test"),
    pipeline: {},
    tools: [],
    guardConfig: { enabled: false },
    channel: null,
    approvalGate: {},
    knowledgeAdapter: { onAssistantMessage() {}, async onTurnEnd() {} },
    memoryStore: {},
    workspaceDir: dir,
    fileStateDir: dir,
    workflowRuntime: {},
    executionEventBus: bus,
    recoveryController: recovery,
    verifier: {},
    buildSystemPrompt: async () => "system",
    chat,
    emit() {},
    runVerificationCommand: async () => ({ code: 0, stdout: "", stderr: "" }),
    getRecoveryState: () => recovery.getRecoveryState(),
    reflectiveThink: async () => ({ decision: "proceed", reason: "" }),
    checkAutoDream: async () => {},
    runStopHook,
  };
}

async function withStopEnv(max, fn) {
  const prevMax = process.env.QLING_STOP_HOOK_MAX_CONTINUATIONS;
  const prevCost = process.env.QLING_RUN_MAX_COST_CNY;
  const prevReliability = process.env.QLING_FEATURES_RELIABILITY_V2;
  process.env.QLING_STOP_HOOK_MAX_CONTINUATIONS = String(max);
  delete process.env.QLING_RUN_MAX_COST_CNY;
  process.env.QLING_FEATURES_RELIABILITY_V2 = "false";
  try {
    await fn();
  } finally {
    if (prevMax === undefined) delete process.env.QLING_STOP_HOOK_MAX_CONTINUATIONS;
    else process.env.QLING_STOP_HOOK_MAX_CONTINUATIONS = prevMax;
    if (prevCost === undefined) delete process.env.QLING_RUN_MAX_COST_CNY;
    else process.env.QLING_RUN_MAX_COST_CNY = prevCost;
    if (prevReliability === undefined) delete process.env.QLING_FEATURES_RELIABILITY_V2;
    else process.env.QLING_FEATURES_RELIABILITY_V2 = prevReliability;
  }
}

test("stop hook continuation limit defaults to 8", () => {
  assert.equal(stopHookMaxContinuations({}), 8);
  assert.equal(stopHookMaxContinuations({ QLING_STOP_HOOK_MAX_CONTINUATIONS: "2" }), 2);
});

test("Stop block continues the turn and the 9th stop is forced", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-stop-loop-"));
  try {
    await withStopEnv(8, async () => {
      let chats = 0;
      const flags = [];
      const host = hostFor(dir, async () => {
        chats += 1;
        return { content: `done-${chats}`, tool_calls: [] };
      }, async (input) => {
        flags.push(input.stopHookActive);
        return { blocked: true, reason: "keep going" };
      });
      const outcome = await runInnerIterationLoop(host);
      assert.equal(outcome.status, "succeeded");
      assert.equal(chats, 9);
      assert.equal(flags.length, 8);
      assert.equal(flags[0], false);
      assert.equal(flags[1], true);
      assert.equal(host.messages.filter((message) => message.role === "user" && message.content === "keep going").length, 8);
      assert.match(outcome.text, /强制结束/);
      assert.match(outcome.text, /done-9/);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a crashing Stop hook still ends the turn", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-stop-crash-"));
  try {
    await withStopEnv(8, async () => {
      let chats = 0;
      const host = hostFor(dir, async () => {
        chats += 1;
        return { content: "finished", tool_calls: [] };
      }, async () => {
        throw new Error("stop hook crashed");
      });
      const outcome = await runInnerIterationLoop(host);
      assert.equal(outcome.status, "succeeded");
      assert.equal(outcome.text, "finished");
      assert.equal(chats, 1);
      assert.equal(host.messages.filter((message) => message.role === "user").length, 1);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
