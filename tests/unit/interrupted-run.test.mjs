import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { repairHistory } from "../../dist/context-history-repair.js";
import { RunTraceStore } from "../../dist/execution/run-trace-store.js";
import {
  INTERRUPTED_RUN_REMINDER,
  decodeTraceTail,
  detectInterruptedRun,
  readRunEventsTail,
  reconcileInterruptedSession,
} from "../../dist/session/interrupted-run.js";

function toolMessages() {
  return [
    { role: "user", content: "do work" },
    {
      role: "assistant",
      content: "",
      tool_calls: [1, 2, 3].map((index) => ({
        id: `call_${index}`,
        type: "function",
        function: { name: "bash", arguments: "{}" },
      })),
    },
    { role: "tool", tool_call_id: "call_1", content: "KEPT_TOOL_RESULT_1" },
    { role: "tool", tool_call_id: "call_2", content: "KEPT_TOOL_RESULT_2" },
  ];
}

function reminderCount(messages) {
  return messages.filter((message) => String(message.content).includes(INTERRUPTED_RUN_REMINDER)).length;
}

async function withStore(run, events = []) {
  const root = await mkdtemp(path.join(tmpdir(), "qling-interrupted-"));
  try {
    const store = new RunTraceStore({ rootDir: root, now: () => 50 });
    for (const event of events) await store.append(event);
    await run(store, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const activeRun = {
  runId: "run_1",
  sessionId: "sess_1",
  originalTask: "do work",
  startedAt: 10,
};

test("an open run trace is interrupted once and keeps saved tool results", async () => {
  await withStore(async (store) => {
    const messages = toolMessages();
    const first = await reconcileInterruptedSession({
      activeRun,
      recoveryStatus: null,
      messages,
      traceStore: store,
      now: () => 60,
    });
    assert.equal(first.interrupted, true);
    assert.equal(first.activeRun, null);
    assert.equal(first.reminderAdded, true);
    assert.equal(reminderCount(first.messages), 1);
    assert.equal(first.messages[2], messages[2]);
    assert.equal(first.messages[3], messages[3]);
    assert.equal(first.messages.filter((message) => message.role === "tool").length, 2);

    const repaired = repairHistory(first.messages);
    assert.equal(repaired.report.strippedToolResultIds.length, 0);
    assert.equal(repaired.report.syntheticResultsInserted, 1);
    assert.equal(repaired.messages.filter((message) => String(message.content).includes("KEPT_TOOL_RESULT_")).length, 2);
    assert.equal(reminderCount(repaired.messages), 1);
    assert.equal(
      repaired.messages.some((message) => message.role === "tool" && message.tool_call_id === "call_3" && message.synthetic_reason === "history_repair"),
      true,
    );

    const second = await reconcileInterruptedSession({
      activeRun: first.activeRun,
      recoveryStatus: null,
      messages: first.messages,
      traceStore: store,
    });
    assert.equal(second.interrupted, false);
    assert.equal(reminderCount(second.messages), 1);

    const reloadedOriginal = await reconcileInterruptedSession({
      activeRun,
      recoveryStatus: null,
      messages,
      traceStore: store,
    });
    assert.equal(reloadedOriginal.interrupted, false);
    assert.equal(reminderCount(reloadedOriginal.messages), 0);

    const raw = await readFile(store.getRunPath("sess_1", "run_1"), "utf8");
    assert.equal(raw.split('"status":"interrupted"').length - 1, 1);
  }, [
    { type: "run_started", runId: "run_1", sessionId: "sess_1", status: "running", timestamp: 10 },
  ]);
});

test("a completed run trace does not remind", async () => {
  await withStore(async (store) => {
    const messages = toolMessages();
    const result = await reconcileInterruptedSession({
      activeRun,
      recoveryStatus: null,
      messages,
      traceStore: store,
    });
    assert.equal(result.interrupted, false);
    assert.equal(result.messages, messages);
    assert.equal(reminderCount(result.messages), 0);
    assert.equal(result.activeRun, activeRun);
  }, [
    { type: "run_started", runId: "run_1", sessionId: "sess_1", status: "running", timestamp: 10 },
    { type: "run_completed", runId: "run_1", sessionId: "sess_1", status: "succeeded", timestamp: 20 },
  ]);
});

test("a recovering run is not marked interrupted", async () => {
  await withStore(async (store) => {
    const messages = toolMessages();
    const result = await reconcileInterruptedSession({
      activeRun,
      recoveryStatus: "recovering",
      messages,
      traceStore: store,
    });
    assert.equal(result.interrupted, false);
    assert.equal(result.messages, messages);
    const raw = await readFile(store.getRunPath("sess_1", "run_1"), "utf8");
    assert.equal(raw.includes('"status":"interrupted"'), false);
  }, [
    { type: "run_started", runId: "run_1", sessionId: "sess_1", status: "running", timestamp: 10 },
  ]);
});

test("trace tail drops a partial first line before detecting an open run", async () => {
  const kept = '{"type":"run_started","runId":"run_tail","sessionId":"sess_tail"}\n';
  const partial = '{"type":"run_completed","status":"succeeded","marker":"DROP_PARTIAL"}';
  const maxBytes = Buffer.byteLength(kept) + 24;
  const file = Buffer.concat([
    Buffer.from("Z".repeat(400)),
    Buffer.from(partial),
    Buffer.from("\n"),
    Buffer.from(kept),
  ]);
  const tail = file.subarray(file.length - maxBytes);
  assert.equal(tail.toString("utf8").includes("DROP_PARTIAL"), true);
  const decoded = decodeTraceTail(tail, true);
  assert.equal(decoded.includes("DROP_PARTIAL"), false);
  assert.match(decoded, /run_started/);
  assert.equal(detectInterruptedRun(JSON.parse(`[${decoded.trim().split(/\n/).join(",")}]`)), true);

  const root = await mkdtemp(path.join(tmpdir(), "qling-trace-tail-"));
  try {
    const store = new RunTraceStore({ rootDir: root });
    const filePath = store.getRunPath("sess_tail", "run_tail");
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, file);
    const events = await readRunEventsTail(filePath, maxBytes);
    assert.equal(events.some((event) => JSON.stringify(event).includes("DROP_PARTIAL")), false);
    assert.equal(detectInterruptedRun(events), true);

    const closed = Buffer.concat([
      Buffer.from(`${"A".repeat(300)}\n`),
      Buffer.from('{"type":"noise","marker":"DROP_PARTIAL"}\n'),
      Buffer.from('{"type":"run_started","runId":"run_closed","sessionId":"sess_tail"}\n'),
      Buffer.from('{"type":"run_completed","runId":"run_closed","sessionId":"sess_tail","status":"succeeded"}\n'),
    ]);
    const closedPath = store.getRunPath("sess_tail", "run_closed");
    await writeFile(closedPath, closed);
    const closedEvents = await readRunEventsTail(closedPath, 180);
    assert.equal(closedEvents.some((event) => JSON.stringify(event).includes("DROP_PARTIAL")), false);
    assert.equal(detectInterruptedRun(closedEvents), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
