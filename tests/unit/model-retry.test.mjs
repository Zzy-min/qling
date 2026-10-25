import test from "node:test";
import assert from "node:assert/strict";

import { ExecutionEventBus } from "../../dist/execution/event-bus.js";
import { classifyFailure } from "../../dist/execution/failure-classifier.js";
import { RecoveryController } from "../../dist/execution/recovery-controller.js";
import { runOuterAgentLoop } from "../../dist/agent/main-loop.js";
import {
  ModelRetryError,
  callModelWithRetry,
  classifyModelError,
  computeBackoffMs,
  parseRetryAfterMs,
  resolveModelRetryPolicy,
} from "../../dist/providers/model-retry.js";

function policy(overrides = {}) {
  return {
    maxRetries: 5,
    baseMs: 1000,
    maxDelayMs: 30_000,
    retryAfterMaxMs: 60_000,
    maxElapsedMs: 300_000,
    runRetryBudget: 20,
    fallbackModels: [],
    streamIdleMs: 0,
    ...overrides,
  };
}

function httpError(message, fields = {}) {
  const error = new Error(message);
  Object.assign(error, fields);
  return error;
}

test("model-retry: classifies transport, rate limit, server, stream, auth, request, context, policy, and cancel errors", () => {
  const cases = [
    [httpError("socket hang up", { code: "ECONNRESET" }), "network", true],
    [httpError("rate limit", { status: 429, retryAfterMs: 2000 }), "rate_limited", true],
    [httpError("unavailable", { status: 500 }), "server", true],
    [httpError("bad gateway", { status: 502 }), "server", true],
    [httpError("unavailable", { status: 503 }), "server", true],
    [httpError("overloaded", { status: 529 }), "server", true],
    [httpError("stream ended before a valid completion", { code: "stream_interrupted" }), "stream_interrupted", true],
    [httpError("grok gateway upstream stream error", { code: "upstream_stream_error" }), "stream_interrupted", true],
    [httpError("unauthorized", { status: 401 }), "auth", false],
    [httpError("forbidden", { status: 403 }), "auth", false],
    [httpError("invalid model", { status: 400 }), "bad_request", false],
    [httpError("missing", { status: 404 }), "bad_request", false],
    [httpError("invalid_request_error: bad payload", { status: 400, code: "invalid_request_error" }), "bad_request", false],
    [httpError("authentication_error", { code: "authentication_error" }), "auth", false],
    [httpError("context_length_exceeded", { status: 400 }), "context_length", false],
    [httpError("maximum context length exceeded", { status: 400 }), "context_length", false],
    [httpError("too many tokens"), "context_length", false],
    [httpError("content_filter", { status: 400 }), "content_policy", false],
    [httpError("blocked by safety policy"), "content_policy", false],
  ];
  for (const [error, kind, retryable] of cases) {
    const classified = classifyModelError(error);
    assert.equal(classified.kind, kind, error.message);
    assert.equal(classified.retryable, retryable, error.message);
  }
  const canceled = new Error("LLM request canceled");
  canceled.name = "AgentRunCanceledError";
  const cancelClass = classifyModelError(canceled);
  assert.equal(cancelClass.kind, "canceled");
  assert.equal(cancelClass.retryable, false);
  assert.equal(classifyModelError(httpError("slow", { status: 429, retryAfterMs: 1500, requestId: "req-9" })).retryAfterMs, 1500);
  assert.equal(classifyModelError(httpError("slow", { status: 429, requestId: "req-9" })).requestId, "req-9");
});

test("model-retry: backoff uses injected rng, cap, and Retry-After seconds or HTTP dates", () => {
  const rules = { baseMs: 1000, maxDelayMs: 30_000, retryAfterMaxMs: 60_000 };
  assert.deepEqual(computeBackoffMs(1, rules, undefined, () => 0), { delayMs: 800, retryAfterExhausted: false });
  assert.deepEqual(computeBackoffMs(1, rules, undefined, () => 1), { delayMs: 1200, retryAfterExhausted: false });
  assert.deepEqual(computeBackoffMs(2, rules, undefined, () => 0), { delayMs: 1600, retryAfterExhausted: false });
  assert.equal(computeBackoffMs(6, rules, undefined, () => 0).delayMs, 24_000);
  assert.equal(computeBackoffMs(1, rules, 5000, () => 0).delayMs, 5000);
  assert.equal(parseRetryAfterMs("2", 0), 2000);
  const now = Date.parse("2026-01-01T00:00:00.000Z");
  assert.equal(parseRetryAfterMs("Thu, 01 Jan 2026 00:00:03 GMT", now), 3000);
});

test("model-retry: Retry-After above the cap does not wait", async () => {
  const sleeps = [];
  const calls = [];
  await assert.rejects(
    callModelWithRetry({
      policy: policy({ maxRetries: 5, retryAfterMaxMs: 60_000 }),
      models: ["primary", "backup"],
      sleep: async (delay) => { sleeps.push(delay); },
      now: () => 0,
      rng: () => 0,
      call: async (model) => {
        calls.push(model);
        throw httpError("slow", { status: 429, retryAfterMs: 120_000 });
      },
    }),
    (error) => {
      assert.ok(error instanceof ModelRetryError);
      assert.equal(error.modelRetryExhausted, true);
      assert.equal(error.lastKind, "rate_limited");
      assert.deepEqual(error.modelsTried, ["primary", "backup"]);
      return true;
    },
  );
  assert.deepEqual(calls, ["primary", "backup"]);
  assert.deepEqual(sleeps, []);
});

test("model-retry: illegal env values fall back and out-of-range values clamp", () => {
  const defaults = resolveModelRetryPolicy({});
  assert.equal(defaults.maxRetries, 5);
  assert.equal(defaults.baseMs, 1000);
  assert.equal(defaults.maxDelayMs, 30_000);
  assert.equal(defaults.retryAfterMaxMs, 60_000);
  assert.equal(defaults.maxElapsedMs, 300_000);
  assert.equal(defaults.runRetryBudget, 20);
  assert.deepEqual(defaults.fallbackModels, []);
  assert.equal(defaults.streamIdleMs, 120_000);

  const illegal = resolveModelRetryPolicy({
    QLING_LLM_MAX_RETRIES: "nope",
    QLING_LLM_RETRY_BASE_MS: "abc",
    QLING_LLM_RETRY_MAX_DELAY_MS: "",
    QLING_LLM_RETRY_AFTER_MAX_MS: "nope",
    QLING_LLM_RETRY_MAX_ELAPSED_MS: "nope",
    QLING_LLM_RUN_RETRY_BUDGET: "nope",
    QLING_LLM_STREAM_IDLE_MS: "nope",
    QLING_LLM_FALLBACK_MODELS: " a, b, c, d ",
  });
  assert.equal(illegal.maxRetries, 5);
  assert.equal(illegal.baseMs, 1000);
  assert.equal(illegal.maxDelayMs, 30_000);
  assert.equal(illegal.retryAfterMaxMs, 60_000);
  assert.equal(illegal.maxElapsedMs, 300_000);
  assert.equal(illegal.runRetryBudget, 20);
  assert.equal(illegal.streamIdleMs, 120_000);
  assert.deepEqual(illegal.fallbackModels, ["a", "b", "c"]);

  const clamped = resolveModelRetryPolicy({
    QLING_LLM_MAX_RETRIES: "100",
    QLING_LLM_RETRY_BASE_MS: "1",
    QLING_LLM_RETRY_MAX_DELAY_MS: "999999",
    QLING_LLM_RETRY_AFTER_MAX_MS: "9999999",
    QLING_LLM_RETRY_MAX_ELAPSED_MS: "99999999",
    QLING_LLM_RUN_RETRY_BUDGET: "500",
    QLING_LLM_STREAM_IDLE_MS: "0",
  });
  assert.equal(clamped.maxRetries, 20);
  assert.equal(clamped.baseMs, 100);
  assert.equal(clamped.maxDelayMs, 120_000);
  assert.equal(clamped.retryAfterMaxMs, 600_000);
  assert.equal(clamped.maxElapsedMs, 1_800_000);
  assert.equal(clamped.runRetryBudget, 200);
  assert.equal(clamped.streamIdleMs, 0);
  assert.equal(resolveModelRetryPolicy({ QLING_LLM_MAX_RETRIES: "-4" }).maxRetries, 0);
});

test("model-retry: retries 429 twice then succeeds", async () => {
  const sleeps = [];
  let calls = 0;
  const result = await callModelWithRetry({
    policy: policy({ maxRetries: 5, baseMs: 1000, maxDelayMs: 30_000 }),
    models: ["primary"],
    rng: () => 0,
    now: () => 0,
    sleep: async (delay) => { sleeps.push(delay); },
    call: async () => {
      calls++;
      if (calls < 3) throw httpError("rate limit", { status: 429, retryAfterMs: 0 });
      return { content: "ok" };
    },
  });
  assert.equal(result.content, "ok");
  assert.equal(calls, 3);
  assert.equal(sleeps.length, 2);
});

test("model-retry: rate limit retries stop at four even when the general cap is higher", async () => {
  let calls = 0;
  await assert.rejects(
    callModelWithRetry({
      policy: policy({ maxRetries: 10 }),
      models: ["primary"],
      sleep: async () => {},
      now: () => 0,
      call: async () => {
        calls++;
        throw httpError("rate limit", { status: 429 });
      },
    }),
    (error) => error instanceof ModelRetryError && error.lastKind === "rate_limited" && error.retries === 4,
  );
  assert.equal(calls, 5);
});

test("model-retry: recovers after three upstream stream errors", async () => {
  let calls = 0;
  const result = await callModelWithRetry({
    policy: policy({ maxRetries: 5 }),
    models: ["grok"],
    sleep: async () => {},
    now: () => 0,
    rng: () => 0,
    call: async () => {
      calls++;
      if (calls <= 3) throw httpError("grok gateway upstream stream error", { code: "upstream_stream_error" });
      return { content: "kept" };
    },
  });
  assert.equal(result.content, "kept");
  assert.equal(calls, 4);
});

test("model-retry: auth failure calls the model once and does not fall back", async () => {
  const calls = [];
  const events = [];
  await assert.rejects(
    callModelWithRetry({
      policy: policy(),
      models: ["primary", "backup"],
      sleep: async () => { throw new Error("should not sleep"); },
      onEvent: (event) => events.push(event.type),
      call: async (model) => {
        calls.push(model);
        throw httpError("unauthorized", { status: 401, code: "authentication_error" });
      },
    }),
    (error) => error instanceof ModelRetryError && error.lastKind === "auth" && error.attempts === 1,
  );
  assert.deepEqual(calls, ["primary"]);
  assert.deepEqual(events, ["model_retry_exhausted"]);
});

test("model-retry: stops when the run retry budget is spent", async () => {
  let calls = 0;
  const runBudget = { remaining: 1 };
  await assert.rejects(
    callModelWithRetry({
      policy: policy({ maxRetries: 10 }),
      models: ["primary"],
      runBudget,
      sleep: async () => {},
      now: () => 0,
      call: async () => {
        calls++;
        throw httpError("reset", { code: "ECONNRESET" });
      },
    }),
    (error) => error instanceof ModelRetryError && error.modelRetryExhausted === true,
  );
  assert.equal(calls, 2);
  assert.equal(runBudget.remaining, 0);
});

test("model-retry: abort during sleep cancels without another attempt", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    callModelWithRetry({
      policy: policy(),
      models: ["primary"],
      signal: controller.signal,
      now: () => 0,
      sleep: async () => {
        controller.abort();
        const canceled = new Error("LLM request canceled");
        canceled.name = "AgentRunCanceledError";
        throw canceled;
      },
      call: async () => {
        calls++;
        throw httpError("reset", { code: "ETIMEDOUT" });
      },
    }),
    (error) => error?.name === "AgentRunCanceledError" && !(error instanceof ModelRetryError),
  );
  assert.equal(calls, 1);
});

test("model-retry: fallback walks primary then backups and stays on the configured model when unset", async () => {
  const calls = [];
  const events = [];
  const result = await callModelWithRetry({
    policy: policy({ maxRetries: 1 }),
    models: ["primary", "fb1", "fb2"],
    sleep: async () => {},
    now: () => 0,
    rng: () => 0,
    onEvent: (event) => events.push(event),
    call: async (model) => {
      calls.push(model);
      if (model !== "fb2") throw httpError("unavailable", { status: 503 });
      return { content: "fb2" };
    },
  });
  assert.equal(result.content, "fb2");
  assert.deepEqual(calls, ["primary", "primary", "fb1", "fb1", "fb2"]);
  assert.deepEqual(
    events.filter((event) => event.type === "model_fallback").map((event) => [event.from, event.to]),
    [["primary", "fb1"], ["fb1", "fb2"]],
  );

  const stuck = [];
  await assert.rejects(
    callModelWithRetry({
      policy: policy({ maxRetries: 1, fallbackModels: [] }),
      models: ["only"],
      sleep: async () => {},
      now: () => 0,
      call: async (model) => {
        stuck.push(model);
        throw httpError("unavailable", { status: 503 });
      },
    }),
    (error) => error instanceof ModelRetryError,
  );
  assert.deepEqual(stuck, ["only", "only"]);
});

test("model-retry: non-retryable errors do not fall back", async () => {
  const calls = [];
  await assert.rejects(
    callModelWithRetry({
      policy: policy(),
      models: ["primary", "fb1"],
      sleep: async () => {},
      call: async (model) => {
        calls.push(model);
        throw httpError("content_filter", { status: 400 });
      },
    }),
    (error) => error instanceof ModelRetryError && error.lastKind === "content_policy",
  );
  assert.deepEqual(calls, ["primary"]);
});

test("model-retry: cost and elapsed budgets stop further attempts", async () => {
  let costCalls = 0;
  await assert.rejects(
    callModelWithRetry({
      policy: policy({ maxRetries: 5 }),
      models: ["primary"],
      costExhausted: () => true,
      sleep: async () => { throw new Error("should not sleep"); },
      call: async () => {
        costCalls++;
        throw httpError("unavailable", { status: 503 });
      },
    }),
    (error) => error instanceof ModelRetryError,
  );
  assert.equal(costCalls, 1);

  let clock = 0;
  let elapsedCalls = 0;
  await assert.rejects(
    callModelWithRetry({
      policy: policy({ maxRetries: 5, maxElapsedMs: 500, baseMs: 1000, maxDelayMs: 30_000 }),
      models: ["primary"],
      now: () => clock,
      rng: () => 0,
      sleep: async (delay) => { clock += delay; },
      call: async () => {
        elapsedCalls++;
        throw httpError("reset", { code: "ECONNRESET" });
      },
    }),
    (error) => error instanceof ModelRetryError,
  );
  assert.equal(elapsedCalls, 1);
});

test("model-retry: failure classifier prefers retriable/code and context length", () => {
  assert.equal(
    classifyFailure(httpError("stream ended", { status: 200, code: "stream_interrupted", retriable: false }), { provider: true }).category,
    "provider_transient",
  );
  assert.equal(
    classifyFailure(httpError("grok gateway upstream stream error", { code: "upstream_stream_error", retriable: true }), { provider: true }).category,
    "provider_transient",
  );
  assert.equal(
    classifyFailure(httpError("context_length_exceeded", { status: 400, retriable: false }), { provider: true }).category,
    "context_exhausted",
  );
  assert.equal(
    classifyFailure(httpError("invalid model", { status: 400, retriable: false }), { provider: true }).category,
    "provider_terminal",
  );
  assert.equal(
    classifyFailure(httpError("down", { status: 503, retriable: true }), { provider: true }).category,
    "provider_transient",
  );
});

test("model-retry: outer loop checkpoints exhaustion and does not stack transport retries", async () => {
  const bus = new ExecutionEventBus();
  const recovery = new RecoveryController();
  let activeRun = null;
  let calls = 0;
  let checkpoints = 0;
  const outcome = await runOuterAgentLoop({
    sessionId: "session-1",
    activeRun,
    messages: [{ role: "user", content: "keep going" }],
    executionEventBus: bus,
    recoveryController: recovery,
    emit: () => {},
    getRecoveryState: () => { try { return recovery.getRecoveryState(); } catch { return null; } },
    formatRecoveryPause: () => "paused",
    applyRecoveryStrategy: async () => {},
    setActiveRun: (run) => { activeRun = run; },
    executeInner: async () => {
      calls++;
      throw new ModelRetryError({
        message: "model call failed: server",
        attempts: 3,
        retries: 2,
        lastKind: "server",
        modelsTried: ["primary", "backup"],
        status: 503,
        code: "server",
        requestId: "req-1",
        retriable: true,
      });
    },
    providerRetryLimit: 5,
    sleep: async () => { throw new Error("transport retry should not sleep"); },
    checkpointSession: async () => { checkpoints++; },
  });
  assert.equal(calls, 1);
  assert.equal(checkpoints, 1);
  assert.equal(outcome.status, "failed");
  assert.match(outcome.text, /server/);
  assert.match(outcome.text, /503/);
  assert.match(outcome.text, /request-id req-1/);
  assert.match(outcome.text, /已重试 2 次/);
  assert.match(outcome.text, /primary,backup/);
  assert.match(outcome.text, /会话已保存为 session-1/);
  assert.match(outcome.text, /qling --resume session-1/);
  assert.match(outcome.text, /!load session-1/);
  assert.equal(activeRun, null);

  let contextCalls = 0;
  const contextOutcome = await runOuterAgentLoop({
    sessionId: "session-ctx",
    activeRun: null,
    messages: [{ role: "user", content: "too long" }],
    executionEventBus: new ExecutionEventBus(),
    recoveryController: new RecoveryController(),
    emit: () => {},
    getRecoveryState: () => null,
    formatRecoveryPause: () => "paused",
    applyRecoveryStrategy: async () => {},
    setActiveRun: () => {},
    executeInner: async () => {
      contextCalls++;
      throw new ModelRetryError({
        message: "model call failed: context_length",
        attempts: 1,
        retries: 0,
        lastKind: "context_length",
        modelsTried: ["primary"],
        status: 400,
        code: "context_length_exceeded",
        retriable: false,
      });
    },
    providerRetryLimit: 5,
    sleep: async () => { throw new Error("should not sleep"); },
    checkpointSession: async () => {},
  });
  assert.equal(contextCalls, 1);
  assert.match(contextOutcome.text, /\/compact/);
});
