import test from "node:test";
import assert from "node:assert/strict";

import {
  HEADLESS_JSON_SCHEMA_VERSION,
  formatHeadlessError,
  formatHeadlessExecutionEvent,
  formatHeadlessResult,
} from "../../dist/cli/headless-json.js";

test("headless json: execution events preserve evidence fields and normalize timestamp", () => {
  const line = formatHeadlessExecutionEvent({
    eventId: "evt_1",
    runId: "run_1",
    sessionId: "session_1",
    type: "tool_completed",
    timestamp: 0,
    status: "succeeded",
    tool: "bash",
    stage: "tool",
  });
  const event = JSON.parse(line);

  assert.equal(event.schemaVersion, HEADLESS_JSON_SCHEMA_VERSION);
  assert.equal(event.timestamp, "1970-01-01T00:00:00.000Z");
  assert.equal(event.runId, "run_1");
  assert.equal(event.sessionId, "session_1");
  assert.equal(event.tool, "bash");
  assert.equal(event.status, "succeeded");
});

test("headless json: result exposes stable session and provider usage summary", () => {
  const event = JSON.parse(
    formatHeadlessResult("done", {
      sessionId: "session_1",
      turnCount: 2,
      tokens: 30,
      promptTokens: 20,
      completionTokens: 10,
      tokenSource: "provider",
    })
  );

  assert.equal(event.schemaVersion, 1);
  assert.equal(event.type, "result");
  assert.equal(event.ok, true);
  assert.equal(event.mode, "run");
  assert.equal(event.result, "done");
  assert.deepEqual(event.session, { id: "session_1", turnCount: 2 });
  assert.deepEqual(event.usage, {
    totalTokens: 30,
    promptTokens: 20,
    completionTokens: 10,
    source: "provider",
  });
  assert.match(event.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test("headless json: errors remain machine readable", () => {
  const event = JSON.parse(formatHeadlessError("RUN_FAILED", "provider unavailable"));
  assert.equal(event.schemaVersion, 1);
  assert.equal(event.type, "error");
  assert.equal(event.ok, false);
  assert.deepEqual(event.error, {
    code: "RUN_FAILED",
    message: "provider unavailable",
  });
});

test("headless json v1 adds optional cost completeness fields", () => {
  const event = JSON.parse(formatHeadlessResult("done", {
    sessionId: "s",
    turnCount: 1,
    tokens: 3,
    promptTokens: 2,
    completionTokens: 1,
    tokenSource: "provider",
    costUsd: "0.0001",
    costIsPartial: false,
    usageIsIncomplete: false,
  }));
  assert.equal(event.schemaVersion, 1);
  assert.equal(event.usage.costUsd, "0.0001");
  assert.equal(event.usage.costIsPartial, false);
  assert.equal(event.usage.usageIsIncomplete, false);
});

test("headless json marks paused and exhausted outcomes as incomplete", () => {
  const stats = {
    sessionId: "s",
    turnCount: 2,
    tokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    tokenSource: "unknown",
  };
  for (const status of ["paused", "exhausted"]) {
    const event = JSON.parse(formatHeadlessResult({
      status,
      runId: "run-1",
      text: `${status} text`,
      ...(status === "exhausted" ? { iterations: 2 } : { recovery: null }),
    }, stats));
    assert.equal(event.schemaVersion, 1);
    assert.equal(event.ok, false);
    assert.equal(event.outcome, status);
  }
});
