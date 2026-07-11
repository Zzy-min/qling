import test from "node:test";
import assert from "node:assert/strict";
import {
  summarizeToolOutputForContext,
  prepareToolResultContent,
  estimateContextLayers,
  resolveToolResultMaxChars,
} from "../../dist/context-tool-hygiene.js";

test("summarizeToolOutputForContext: short text unchanged", () => {
  const s = "hello world";
  assert.equal(summarizeToolOutputForContext(s, { maxChars: 100 }), s);
});

test("summarizeToolOutputForContext: long text folded with meta", () => {
  const s = "A".repeat(5000) + "MIDDLE" + "B".repeat(5000);
  const out = summarizeToolOutputForContext(s, {
    maxChars: 1000,
    headChars: 100,
    tailChars: 100,
  });
  assert.ok(out.length < s.length);
  assert.match(out, /已截断/);
  assert.ok(out.startsWith("A".repeat(100)));
  assert.ok(out.endsWith("B".repeat(100)));
});

test("summarizeToolOutputForContext: small max clamps default head and tail", () => {
  const s = "A".repeat(5000) + "B".repeat(5000);
  const maxChars = 320;
  const out = summarizeToolOutputForContext(s, { maxChars });

  assert.match(out, /已截断/);
  assert.ok(
    out.length <= maxChars,
    `summary length ${out.length} exceeded configured max ${maxChars}`
  );
  assert.ok(out.startsWith("A"));
  assert.ok(out.endsWith("B"));
});

test("summarizeToolOutputForContext: tiny max never grows the payload", () => {
  const s = "X".repeat(500);
  const out = summarizeToolOutputForContext(s, { maxChars: 24 });
  assert.ok(out.length <= 24, `tiny summary was ${out.length} chars`);
});

test("summarizeToolOutputForContext: maxChars 0 disables", () => {
  const s = "X".repeat(20000);
  assert.equal(summarizeToolOutputForContext(s, { maxChars: 0 }), s);
});

test("prepareToolResultContent: compresses JSON output field only", () => {
  const big = "Z".repeat(8000);
  const raw = JSON.stringify({
    tool_call_id: "t1",
    output: big,
    is_error: false,
  });
  const out = prepareToolResultContent(raw, {
    maxChars: 500,
    headChars: 50,
    tailChars: 50,
  });
  const parsed = JSON.parse(out);
  assert.equal(parsed.tool_call_id, "t1");
  assert.equal(parsed.is_error, false);
  assert.ok(parsed.output.length < big.length);
  assert.match(parsed.output, /已截断/);
});

test("estimateContextLayers: splits tool vs history", () => {
  const layers = estimateContextLayers([
    { role: "user", content: "abc" },
    { role: "assistant", content: "de" },
    { role: "tool", content: "toolout12345" },
  ]);
  assert.equal(layers.messageCount, 3);
  assert.equal(layers.toolMessageCount, 1);
  assert.equal(layers.historyChars, 5);
  assert.equal(layers.toolOutputChars, "toolout12345".length);
  assert.ok(layers.totalChars >= 16);
});

test("resolveToolResultMaxChars: env override", () => {
  assert.equal(resolveToolResultMaxChars({}), 6000);
  assert.equal(resolveToolResultMaxChars({ QLING_TOOL_RESULT_MAX_CHARS: "0" }), 0);
  assert.equal(resolveToolResultMaxChars({ QLING_TOOL_RESULT_MAX_CHARS: "1200" }), 1200);
});
