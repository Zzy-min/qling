import test from "node:test";
import assert from "node:assert/strict";

import { parseAgentEvalOutput } from "../../dist/eval/agent-output.js";

test("agent eval output parser extracts result, usage, and tool failures", () => {
  const output = [
    JSON.stringify({ type: "tool_completed", tool: "bash", status: "failed" }),
    JSON.stringify({ type: "tool_completed", tool: "read", status: "succeeded" }),
    JSON.stringify({
      type: "result",
      ok: true,
      result: '```json\n{"name":"pkg","version":"1.0.0","testScript":"node --test"}\n```',
      usage: { totalTokens: 123, promptTokens: 100, completionTokens: 23 },
    }),
  ].join("\n");

  assert.deepEqual(parseAgentEvalOutput(output), {
    answer: { name: "pkg", version: "1.0.0", testScript: "node --test" },
    ok: true,
    usage: { totalTokens: 123, promptTokens: 100, completionTokens: 23 },
    toolCalls: 2,
    toolFailures: 1,
    tools: ["bash", "read"],
  });
});

test("agent eval output parser rejects a missing terminal result", () => {
  assert.throws(() => parseAgentEvalOutput('{"type":"run_started"}\n'), /terminal result/);
});

test("agent eval output parser extracts a JSON object after explanatory prose", () => {
  const output = JSON.stringify({
    type: "result",
    ok: true,
    result: '测试通过。\n\n{"changed":["src/a.mjs"],"tests":"passed"}',
    usage: {},
  });
  assert.deepEqual(parseAgentEvalOutput(output).answer, {
    changed: ["src/a.mjs"],
    tests: "passed",
  });
});

test("agent eval output parser preserves failed terminal results with non-JSON text", () => {
  const parsed = parseAgentEvalOutput(JSON.stringify({
    type: "result",
    ok: false,
    result: "maximum iterations reached",
    usage: { totalTokens: 99 },
  }));
  assert.equal(parsed.ok, false);
  assert.deepEqual(parsed.answer, {});
  assert.match(parsed.answerParseError, /Unexpected token|JSON/);
  assert.equal(parsed.usage.totalTokens, 99);
});
