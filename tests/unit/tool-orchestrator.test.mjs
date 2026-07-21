import test from "node:test";
import assert from "node:assert/strict";

import {
  buildToolSignature,
  parseToolArguments,
  prepareToolCalls,
  executePreparedTools,
  repairToolArguments,
  stableStringify,
} from "../../dist/agent/tool-orchestrator.js";
import { ExecutionEventBus } from "../../dist/execution/event-bus.js";

test("parseToolArguments accepts object JSON and rejects arrays", () => {
  assert.deepEqual(parseToolArguments('{"path":"a.ts"}').value, { path: "a.ts" });
  assert.equal(parseToolArguments("[1,2]").ok, false);
});

test("parseToolArguments repairs fenced and trailing-comma JSON with retries", () => {
  const fenced = parseToolArguments("```json\n{\"path\": \"x.ts\"}\n```", 1);
  assert.equal(fenced.ok, true);
  assert.equal(fenced.value.path, "x.ts");

  const trailing = parseToolArguments('{"path":"y.ts",}', 2);
  assert.equal(trailing.ok, true);
  assert.equal(trailing.value.path, "y.ts");
});

test("repairToolArguments strips fences on first attempt", () => {
  assert.equal(repairToolArguments("```json\n{\"a\":1}\n```", 0), '{"a":1}');
});

test("stableStringify is key-order independent for signatures", () => {
  const a = buildToolSignature("read", { b: 1, a: 2 });
  const b = buildToolSignature("read", { a: 2, b: 1 });
  assert.equal(a, b);
  assert.equal(stableStringify({ z: 1, a: 2 }), '{"a":2,"z":1}');
});

test("prepareToolCalls enforces per-signature repeat limit", () => {
  const raw = [
    {
      id: "1",
      type: "function",
      function: { name: "read", arguments: '{"path":"a.ts"}' },
    },
    {
      id: "2",
      type: "function",
      function: { name: "read", arguments: '{"path":"a.ts"}' },
    },
  ];
  const prepared = prepareToolCalls(raw, { toolRepeatLimit: 1, parseRetries: 0 });
  assert.equal(prepared.length, 2);
  assert.equal(prepared[0].immediateResult, undefined);
  assert.equal(prepared[1].immediateResult?.error?.code, "TOOL_REPEAT_LIMIT_EXCEEDED");
  assert.equal(prepared[1].loopDetected?.count, 2);
  assert.equal(prepared[1].loopDetected?.limit, 1);
});

test("prepareToolCalls marks invalid arguments immediately", () => {
  const prepared = prepareToolCalls(
    [
      {
        id: "bad",
        type: "function",
        function: { name: "read", arguments: "not-json" },
      },
    ],
    { parseRetries: 0 }
  );
  assert.equal(prepared[0].immediateResult?.error?.code, "TOOL_INVALID_ARGUMENTS");
});

test("executePreparedTools counts a pipeline is_error result exactly once", async () => {
  const messages = [];
  const bus = new ExecutionEventBus();
  const events = [];
  bus.subscribe((event) => events.push(event));
  const result = await executePreparedTools({
    pipeline: { execute: async () => ({ tool_call_id: "1", output: "forbidden", is_error: true }) },
    tools: [],
    guardConfig: { enabled: false },
    channel: null,
    approvalGate: {},
    knowledgeAdapter: { onToolCall() {}, onToolResult() {} },
    memoryStore: { link() {} },
    workspaceDir: process.cwd(),
    workflowRuntime: {},
    executionEventBus: bus,
    emit() {},
    reflectiveThink: async () => ({ decision: "proceed", reason: "" }),
  }, {
    preparedCalls: [{ call: { id: "1", name: "read", arguments: { path: "x" } } }],
    messages,
    runId: "run-1",
    attemptId: "attempt-1",
  });
  assert.equal(result.turnToolFailures, 1);
  assert.equal(events.filter((event) => event.type === "tool_completed").length, 1);
  assert.equal(events.find((event) => event.type === "tool_completed")?.status, "failed");
});
