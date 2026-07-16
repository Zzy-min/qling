import test from "node:test";
import assert from "node:assert/strict";

import {
  buildToolSignature,
  parseToolArguments,
  prepareToolCalls,
  repairToolArguments,
  stableStringify,
} from "../../dist/agent/tool-orchestrator.js";

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
