import test from "node:test";
import assert from "node:assert/strict";
import { repairHistory } from "../../dist/context-history-repair.js";

function assistant(id, extra = {}) {
  return {
    role: "assistant",
    content: "",
    tool_calls: [{ id, type: "function", function: { name: "read", arguments: "{}" } }],
    ...extra,
  };
}

function tool(id, content = "ok", extra = {}) {
  return { role: "tool", tool_call_id: id, content, ...extra };
}

const SYNTHETIC = "[工具未返回结果：执行被中断]";

test("repairHistory: removes duplicate tool results keeping the first", () => {
  const { messages, report } = repairHistory([
    assistant("t1"),
    tool("t1", "first"),
    tool("t1", "second"),
  ]);

  assert.equal(messages.length, 2);
  assert.equal(messages[1].content, "first");
  assert.equal(report.duplicatesRemoved, 1);
  assert.equal(report.syntheticResultsInserted, 0);
  assert.deepEqual(report.strippedToolResultIds, []);
  assert.equal(report.changed, true);
});

test("repairHistory: strips orphan tool results with no declaring assistant", () => {
  const { messages, report } = repairHistory([
    { role: "user", content: "hi" },
    tool("orphan", "stray"),
  ]);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, "user");
  assert.deepEqual(report.strippedToolResultIds, ["orphan"]);
  assert.equal(report.syntheticResultsInserted, 0);
  assert.equal(report.changed, true);
});

test("repairHistory: strips displaced tool results separated by a user turn", () => {
  const { messages, report } = repairHistory([
    assistant("t1"),
    { role: "user", content: "interrupt" },
    tool("t1", "late"),
  ]);

  assert.deepEqual(
    messages.map((m) => m.role),
    ["assistant", "tool", "user"],
  );
  // synthetic answer sits right after its assistant; the late real result is dropped
  assert.equal(messages[1].tool_call_id, "t1");
  assert.equal(messages[1].content, SYNTHETIC);
  assert.equal(messages[2].content, "interrupt");
  assert.deepEqual(report.strippedToolResultIds, ["t1"]);
  assert.equal(report.syntheticResultsInserted, 1);
  assert.equal(report.changed, true);
});

test("repairHistory: inserts synthetic results for unanswered tool calls", () => {
  const message = assistant("t1");
  message.tool_calls.push({ id: "t2", type: "function", function: { name: "write", arguments: "{}" } });

  const { messages, report } = repairHistory([message, tool("t1", "real")]);

  assert.equal(messages.length, 3);
  assert.equal(messages[1].content, "real");
  assert.equal(messages[2].role, "tool");
  assert.equal(messages[2].tool_call_id, "t2");
  assert.equal(messages[2].content, SYNTHETIC);
  assert.equal(messages[2].synthetic_reason, "history_repair");
  assert.equal(report.syntheticResultsInserted, 1);
  assert.equal(report.strippedToolResultIds.length, 0);
  assert.equal(report.changed, true);
});

test("repairHistory: is idempotent after the first repair", () => {
  const messy = [
    { role: "user", content: "task" },
    assistant("t1"),
    tool("t1", "first"),
    tool("t1", "duplicate"),
    { role: "user", content: "interrupt" },
    tool("t2", "late"),
    tool("orphan", "stray"),
  ];

  const first = repairHistory(messy);
  assert.equal(first.report.changed, true);

  const second = repairHistory(first.messages);
  assert.deepEqual(second.report, {
    duplicatesRemoved: 0,
    strippedToolResultIds: [],
    syntheticResultsInserted: 0,
    changed: false,
  });
  assert.deepEqual(second.messages, first.messages);
});
