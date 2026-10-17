import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

import {
  installAcpStdoutGuard,
  QlingAcpServer,
  runAcpStdioServer,
} from "../../dist/cli/acp-server.js";
import { INTERRUPTED_RUN_REMINDER } from "../../dist/session/interrupted-run.js";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 1500) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for ACP update");
    await delay(10);
  }
}

class FakeAgent {
  constructor(id = "acp-session", options = {}) {
    this.id = id;
    this.options = options;
    this.messages = [];
    this.plan = false;
    this.permission = "ask";
    this.listener = () => {};
    this.channel = null;
    this.cancelReject = null;
    this.shutdownCount = 0;
    this.runCount = 0;
    this.toolCount = 0;
    this.handlers = new Map();
    this.restoredId = null;
    this.traceReads = 0;
    if (options.runDetailed) {
      this.runDetailed = () => options.runDetailed(this);
    }
  }

  async waitForInit() {}
  getSessionId() { return this.id; }
  addUserMessage(content) { this.messages.push(content); }
  setChannel(channel) { this.channel = channel; }
  setPlanMode(enabled) { this.plan = enabled; }
  setPermissionMode(mode) { this.permission = mode; }
  subscribeExecutionEvents(listener) {
    this.listener = listener;
    return () => { this.listener = () => {}; };
  }
  on(event, handler) {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler);
    this.handlers.set(event, set);
    return () => set.delete(handler);
  }
  emit(event, ...args) {
    for (const handler of this.handlers.get(event) ?? []) handler(...args);
  }
  async restoreSession(id) {
    this.restoredId = id;
    return this.options.restore ? this.options.restore(id) : null;
  }
  getMessagesSnapshot() { return this.options.messages ?? []; }
  getActiveRun() { return this.options.activeRun ?? null; }
  getRecoveryState() { return this.options.recoveryState ?? null; }
  async readRunTrace() {
    this.traceReads += 1;
    return this.options.trace ?? [];
  }
  async run() {
    this.runCount += 1;
    if (this.options.run) return this.options.run(this);
    if (this.options.behavior === "pending") {
      return new Promise((_resolve, reject) => { this.cancelReject = reject; });
    }
    return this.options.result ?? "ok";
  }
  cancelActiveRun() {
    if (!this.cancelReject) return false;
    const error = new Error("Agent run canceled");
    error.name = "AgentRunCanceledError";
    this.cancelReject(error);
    this.cancelReject = null;
    return true;
  }
  async shutdown() { this.shutdownCount += 1; }
}

function makeHarness(factory) {
  const updates = [];
  const permissions = [];
  const server = new QlingAcpServer(factory);
  const clientApp = acp.client({ name: "qling-test-client" })
    .onNotification(acp.methods.client.session.update, (ctx) => { updates.push(ctx.params.update); })
    .onRequest(acp.methods.client.session.requestPermission, (ctx) => {
      permissions.push(ctx.params);
      return { outcome: { outcome: "selected", optionId: "allow_once" } };
    });
  const connection = clientApp.connect(server.createApp());
  return { server, connection, ctx: connection.agent, updates, permissions };
}

function textChunks(updates, kind = "agent_message_chunk") {
  return updates.filter((update) => update.sessionUpdate === kind);
}

function joined(updates, kind = "agent_message_chunk") {
  return textChunks(updates, kind).map((update) => update.content?.text ?? "").join("");
}

async function openSession(h, idFactory) {
  return h.ctx.request(acp.methods.agent.session.new, {
    cwd: process.cwd(),
    mcpServers: [],
  });
}

test("acp: merged stream chunks equal the full text and are not repeated", async (t) => {
  const fake = new FakeAgent("acp-merge", {
    run: async (agent) => {
      agent.emit("response_delta", "alpha ");
      agent.emit("response_delta", "beta ");
      agent.emit("response_delta", "gamma");
      return "alpha beta gamma";
    },
  });
  const h = makeHarness(() => fake);
  t.after(async () => { h.connection.close(); await h.server.shutdown(); });
  const created = await openSession(h);
  const result = await h.ctx.request(acp.methods.agent.session.prompt, {
    sessionId: created.sessionId,
    prompt: [{ type: "text", text: "stream" }],
  });
  assert.equal(result.stopReason, "end_turn");
  const chunks = textChunks(h.updates);
  assert.equal(joined(h.updates), "alpha beta gamma");
  assert.equal(chunks.length, 1);
  assert.equal(chunks.filter((chunk) => chunk.content.text === "alpha beta gamma").length, 1);
});

test("acp: flushes a text batch at 1KB and again for the remainder", async (t) => {
  const head = "A".repeat(1024);
  const fake = new FakeAgent("acp-1kb", {
    run: async (agent) => {
      agent.emit("response_delta", head);
      await waitFor(() => textChunks(h.updates).some((chunk) => chunk.content.text === head));
      agent.emit("response_delta", "Z");
      return `${head}Z`;
    },
  });
  const h = makeHarness(() => fake);
  t.after(async () => { h.connection.close(); await h.server.shutdown(); });
  const created = await openSession(h);
  const result = await h.ctx.request(acp.methods.agent.session.prompt, {
    sessionId: created.sessionId,
    prompt: [{ type: "text", text: "stream" }],
  });
  assert.equal(result.stopReason, "end_turn");
  assert.equal(joined(h.updates), `${head}Z`);
  assert.equal(textChunks(h.updates).length, 2);
  assert.equal(h.updates.filter((update) => update.content?.text === `${head}Z${head}Z`).length, 0);
});

test("acp: flushes a short text batch after 200ms", async (t) => {
  const fake = new FakeAgent("acp-200ms", {
    run: async (agent) => {
      agent.emit("response_delta", "hi");
      await waitFor(() => textChunks(h.updates).some((chunk) => chunk.content.text === "hi"), 1500);
      agent.emit("response_delta", "!");
      return "hi!";
    },
  });
  const h = makeHarness(() => fake);
  t.after(async () => { h.connection.close(); await h.server.shutdown(); });
  const created = await openSession(h);
  const result = await h.ctx.request(acp.methods.agent.session.prompt, {
    sessionId: created.sessionId,
    prompt: [{ type: "text", text: "stream" }],
  });
  assert.equal(result.stopReason, "end_turn");
  assert.equal(joined(h.updates), "hi!");
  assert.ok(textChunks(h.updates).length >= 2);
});

test("acp: EventEmitter response_delta reaches the client without a second full copy", async (t) => {
  const agent = new EventEmitter();
  Object.assign(agent, {
    id: "acp-emitter",
    messages: [],
    async waitForInit() {},
    getSessionId() { return this.id; },
    addUserMessage(content) { this.messages.push(content); },
    setChannel() {},
    setPlanMode() {},
    setPermissionMode() {},
    subscribeExecutionEvents() { return () => {}; },
    cancelActiveRun() { return false; },
    async shutdown() {},
    async run() {
      this.emit("response_delta", "one");
      this.emit("response_delta", "-two");
      return "one-two";
    },
  });
  const h = makeHarness(() => agent);
  t.after(async () => { h.connection.close(); await h.server.shutdown(); });
  const created = await openSession(h);
  const result = await h.ctx.request(acp.methods.agent.session.prompt, {
    sessionId: created.sessionId,
    prompt: [{ type: "text", text: "stream" }],
  });
  assert.equal(result.stopReason, "end_turn");
  assert.equal(joined(h.updates), "one-two");
});

test("acp: streaming still asks for permission before a tool runs", async (t) => {
  const fake = new FakeAgent("acp-stream-approval", {
    run: async (agent) => {
      agent.emit("response_delta", "before ");
      const approval = await agent.channel.requestApproval({
        id: "approval-stream",
        toolName: "write",
        arguments: { path: "README.md" },
        reason: "workspace change",
        timestamp: Date.now(),
      });
      agent.toolCount += 1;
      agent.emit("response_delta", approval.decision);
      return `before ${approval.decision}`;
    },
  });
  const h = makeHarness(() => fake);
  t.after(async () => { h.connection.close(); await h.server.shutdown(); });
  const created = await openSession(h);
  const result = await h.ctx.request(acp.methods.agent.session.prompt, {
    sessionId: created.sessionId,
    prompt: [{ type: "text", text: "edit" }],
  });
  assert.equal(result.stopReason, "end_turn");
  assert.equal(h.permissions.length, 1);
  assert.equal(fake.toolCount, 1);
  assert.equal(joined(h.updates), "before allow");
  assert.equal(h.updates.filter((update) => update.content?.text === "before allowbefore allow").length, 0);
});

test("acp: tool_call rawInput and tool output stay inside 4KB and 2KB", async (t) => {
  const marker = "UNIQUE_MIDDLE_MARKER";
  const output = `${"H".repeat(4000)}${marker}${"T".repeat(4000)}`;
  const fake = new FakeAgent("acp-truncate", {
    run: async (agent) => {
      agent.listener({
        eventId: "e1", runId: "r1", sessionId: agent.id, attemptId: "a1",
        toolCallId: "tool-big", type: "tool_started", timestamp: Date.now(),
        status: "running", tool: "bash",
      });
      agent.emit("tool_start", "bash", { cmd: "x".repeat(8000), tail: "ARG_TAIL_MARKER" });
      agent.emit("tool_result", "bash", output, false);
      agent.listener({
        eventId: "e2", runId: "r1", sessionId: agent.id, attemptId: "a1",
        toolCallId: "tool-big", type: "tool_completed", timestamp: Date.now(),
        status: "succeeded", tool: "bash",
      });
      return "done";
    },
  });
  const h = makeHarness(() => fake);
  t.after(async () => { h.connection.close(); await h.server.shutdown(); });
  const created = await openSession(h);
  await h.ctx.request(acp.methods.agent.session.prompt, {
    sessionId: created.sessionId,
    prompt: [{ type: "text", text: "run" }],
  });
  const call = h.updates.find((update) => update.sessionUpdate === "tool_call");
  const update = h.updates.find((update) => update.sessionUpdate === "tool_call_update");
  const raw = typeof call.rawInput === "string" ? call.rawInput : JSON.stringify(call.rawInput);
  const summary = update.content[0].content.text;
  assert.ok(Buffer.byteLength(raw, "utf8") <= 4096);
  assert.equal(raw.includes("ARG_TAIL_MARKER"), false);
  assert.ok(Buffer.byteLength(summary, "utf8") <= 2048);
  assert.equal(summary.includes(marker), false);
  assert.equal(JSON.stringify(update).includes(output), false);
});

test("acp: approval rawInput is truncated and still goes through requestPermission", async (t) => {
  const fake = new FakeAgent("acp-approval-trunc", {
    run: async (agent) => {
      await agent.channel.requestApproval({
        id: "approval-big",
        toolName: "bash",
        arguments: { cmd: "c".repeat(8000), tail: "APPROVAL_TAIL" },
        reason: "run",
        timestamp: Date.now(),
      });
      return "ok";
    },
  });
  const h = makeHarness(() => fake);
  t.after(async () => { h.connection.close(); await h.server.shutdown(); });
  const created = await openSession(h);
  await h.ctx.request(acp.methods.agent.session.prompt, {
    sessionId: created.sessionId,
    prompt: [{ type: "text", text: "run" }],
  });
  assert.equal(h.permissions.length, 1);
  const rawValue = h.permissions[0].toolCall.rawInput;
  const raw = typeof rawValue === "string" ? rawValue : JSON.stringify(rawValue);
  assert.ok(Buffer.byteLength(raw, "utf8") <= 4096);
  assert.equal(raw.includes("APPROVAL_TAIL"), false);
});

test("acp: maps plan and todo events onto a plan update", async (t) => {
  const fake = new FakeAgent("acp-plan", {
    run: async (agent) => {
      agent.emit("plan", [{ content: "write tests", status: "in_progress", priority: "high" }]);
      agent.emit("todo", { todos: [{ content: "ship it", status: "pending", priority: "low" }] });
      return "planned";
    },
  });
  const h = makeHarness(() => fake);
  t.after(async () => { h.connection.close(); await h.server.shutdown(); });
  const created = await openSession(h);
  await h.ctx.request(acp.methods.agent.session.prompt, {
    sessionId: created.sessionId,
    prompt: [{ type: "text", text: "plan" }],
  });
  const plans = h.updates.filter((update) => update.sessionUpdate === "plan");
  assert.equal(plans.length, 2);
  assert.equal(plans[0].entries[0].content, "write tests");
  assert.equal(plans[0].entries[0].status, "in_progress");
  assert.equal(plans[0].entries[0].priority, "high");
  assert.equal(plans[1].entries[0].content, "ship it");
  assert.equal(plans[1].entries[0].status, "pending");
});

test("acp: paused and recovering outcomes end the turn with an explanation instead of throwing", async (t) => {
  const cases = [
    { status: "paused", text: "执行已暂停\n原因: disk" },
    { status: "recovering", text: "正在恢复，先不中断会话。" },
  ];
  for (const outcome of cases) {
    const fake = new FakeAgent(`acp-${outcome.status}`, {
      runDetailed: async () => ({ ...outcome, recovery: { status: outcome.status } }),
      run: async () => { throw new Error("runDetailed should handle this outcome"); },
    });
    const h = makeHarness(() => fake);
    try {
      const created = await openSession(h);
      const result = await h.ctx.request(acp.methods.agent.session.prompt, {
        sessionId: created.sessionId,
        prompt: [{ type: "text", text: "go" }],
      });
      assert.equal(result.stopReason, "end_turn");
      assert.match(joined(h.updates), new RegExp(outcome.text.split("\n")[0]));
    } finally {
      h.connection.close();
      await h.server.shutdown();
    }
  }
});

test("acp: an unrecoverable failed outcome still throws", async (t) => {
  const fake = new FakeAgent("acp-failed", {
    runDetailed: async () => ({ status: "failed", text: "unrecoverable boom" }),
  });
  const h = makeHarness(() => fake);
  t.after(async () => { h.connection.close(); await h.server.shutdown(); });
  const created = await openSession(h);
  await assert.rejects(
    h.ctx.request(acp.methods.agent.session.prompt, {
      sessionId: created.sessionId,
      prompt: [{ type: "text", text: "go" }],
    }),
    /unrecoverable boom/,
  );
});

test("acp: a second prompt is queued and both finish in order", async (t) => {
  const order = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const fake = new FakeAgent("acp-queue", {
    run: async (agent) => {
      const text = agent.messages.at(-1);
      order.push(`start:${text}`);
      if (text === "one") await firstGate;
      else await delay(10);
      order.push(`end:${text}`);
      return text;
    },
  });
  const h = makeHarness(() => fake);
  t.after(async () => { h.connection.close(); await h.server.shutdown(); });
  const created = await openSession(h);
  const first = h.ctx.request(acp.methods.agent.session.prompt, {
    sessionId: created.sessionId,
    prompt: [{ type: "text", text: "one" }],
  });
  await waitFor(() => order[0] === "start:one");
  const second = h.ctx.request(acp.methods.agent.session.prompt, {
    sessionId: created.sessionId,
    prompt: [{ type: "text", text: "two" }],
  });
  await delay(20);
  assert.deepEqual(order, ["start:one"]);
  releaseFirst();
  assert.equal((await first).stopReason, "end_turn");
  assert.equal((await second).stopReason, "end_turn");
  assert.deepEqual(order, ["start:one", "end:one", "start:two", "end:two"]);
  assert.deepEqual(fake.messages, ["one", "two"]);
});

test("acp: a queued prompt still requests permission", async (t) => {
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const fake = new FakeAgent("acp-queue-approval", {
    run: async (agent) => {
      const text = agent.messages.at(-1);
      const approval = await agent.channel.requestApproval({
        id: `approval-${text}`,
        toolName: "write",
        arguments: { path: `${text}.txt` },
        reason: "workspace change",
        timestamp: Date.now(),
      });
      agent.toolCount += 1;
      if (text === "one") await firstGate;
      return `${text}:${approval.decision}`;
    },
  });
  const h = makeHarness(() => fake);
  t.after(async () => { h.connection.close(); await h.server.shutdown(); });
  const created = await openSession(h);
  const first = h.ctx.request(acp.methods.agent.session.prompt, {
    sessionId: created.sessionId,
    prompt: [{ type: "text", text: "one" }],
  });
  await waitFor(() => h.permissions.length === 1);
  const second = h.ctx.request(acp.methods.agent.session.prompt, {
    sessionId: created.sessionId,
    prompt: [{ type: "text", text: "two" }],
  });
  await delay(30);
  assert.equal(h.permissions.length, 1);
  assert.equal(fake.toolCount, 1);
  releaseFirst();
  assert.equal((await first).stopReason, "end_turn");
  assert.equal((await second).stopReason, "end_turn");
  assert.equal(h.permissions.length, 2);
  assert.equal(fake.toolCount, 2);
  assert.deepEqual(h.permissions.map((permission) => permission.toolCall.toolCallId), ["approval-one", "approval-two"]);
});

test("acp: cancelling the active prompt cancels the queue before it runs tools", async (t) => {
  const fake = new FakeAgent("acp-cancel-queue", { behavior: "pending" });
  const h = makeHarness(() => fake);
  t.after(async () => { h.connection.close(); await h.server.shutdown(); });
  const created = await openSession(h);
  const first = h.ctx.request(acp.methods.agent.session.prompt, {
    sessionId: created.sessionId,
    prompt: [{ type: "text", text: "wait" }],
  });
  await waitFor(() => fake.runCount === 1);
  const second = h.ctx.request(acp.methods.agent.session.prompt, {
    sessionId: created.sessionId,
    prompt: [{ type: "text", text: "queued" }],
  });
  await delay(20);
  await h.ctx.notify(acp.methods.agent.session.cancel, { sessionId: created.sessionId });
  assert.equal((await first).stopReason, "cancelled");
  assert.equal((await second).stopReason, "cancelled");
  assert.equal(fake.runCount, 1);
  assert.equal(fake.toolCount, 0);
  assert.deepEqual(fake.messages, ["wait"]);
  assert.equal(h.permissions.length, 0);
});

test("acp: the prompt queue rejects once QLING_ACP_MAX_QUEUED is reached", async (t) => {
  const previous = process.env.QLING_ACP_MAX_QUEUED;
  process.env.QLING_ACP_MAX_QUEUED = "1";
  const fake = new FakeAgent("acp-queue-limit", { behavior: "pending" });
  const h = makeHarness(() => fake);
  if (previous === undefined) delete process.env.QLING_ACP_MAX_QUEUED;
  else process.env.QLING_ACP_MAX_QUEUED = previous;
  t.after(async () => {
    if (previous === undefined) delete process.env.QLING_ACP_MAX_QUEUED;
    else process.env.QLING_ACP_MAX_QUEUED = previous;
    h.connection.close();
    await h.server.shutdown();
  });
  const created = await openSession(h);
  const first = h.ctx.request(acp.methods.agent.session.prompt, {
    sessionId: created.sessionId,
    prompt: [{ type: "text", text: "wait" }],
  });
  await waitFor(() => fake.runCount === 1);
  const second = h.ctx.request(acp.methods.agent.session.prompt, {
    sessionId: created.sessionId,
    prompt: [{ type: "text", text: "queued" }],
  });
  await delay(30);
  await assert.rejects(
    h.ctx.request(acp.methods.agent.session.prompt, {
      sessionId: created.sessionId,
      prompt: [{ type: "text", text: "overflow" }],
    }),
    /queue is full/,
  );
  await h.ctx.notify(acp.methods.agent.session.cancel, { sessionId: created.sessionId });
  assert.equal((await first).stopReason, "cancelled");
  assert.equal((await second).stopReason, "cancelled");
  assert.equal(fake.messages.includes("overflow"), false);
});

test("acp: newSession still rejects client MCP servers and additionalDirectories", async (t) => {
  let calls = 0;
  const h = makeHarness(() => { calls += 1; return new FakeAgent("unused"); });
  t.after(async () => { h.connection.close(); await h.server.shutdown(); });
  await assert.rejects(
    h.ctx.request(acp.methods.agent.session.new, {
      cwd: process.cwd(),
      mcpServers: [{ name: "x", command: process.execPath, args: [], env: [] }],
    }),
    /MCP servers are not supported/,
  );
  await assert.rejects(
    h.ctx.request(acp.methods.agent.session.new, {
      cwd: process.cwd(),
      mcpServers: [],
      additionalDirectories: [process.cwd()],
    }),
    /additionalDirectories are not supported/,
  );
  assert.equal(calls, 0);
});

test("acp: loadSession replays user, assistant, and completed tool calls", async (t) => {
  const bigArg = "y".repeat(8000);
  const bigOut = `${"a".repeat(4000)}OUTPUT_MIDDLE_SECRET${"b".repeat(4000)}`;
  const messages = [
    { role: "user", content: "u1" },
    { role: "assistant", content: "a1" },
    { role: "user", content: "u2" },
    {
      role: "assistant",
      content: "a2",
      tool_calls: [{
        id: "c1",
        type: "function",
        function: { name: "read", arguments: JSON.stringify({ path: "a.txt", blob: bigArg }) },
      }],
    },
    { role: "tool", tool_call_id: "c1", content: bigOut },
  ];
  const fake = new FakeAgent("ignored-live-id", {
    restore: (id) => (id === "session-saved" ? { name: id } : null),
    messages,
    result: "continued",
  });
  const h = makeHarness(() => fake);
  t.after(async () => { h.connection.close(); await h.server.shutdown(); });
  const loaded = await h.ctx.request(acp.methods.agent.session.load, {
    cwd: process.cwd(),
    mcpServers: [],
    sessionId: "session-saved",
  });
  assert.equal(loaded.modes.currentModeId, "normal");
  assert.equal(fake.restoredId, "session-saved");
  assert.deepEqual(textChunks(h.updates, "user_message_chunk").map((chunk) => chunk.content.text), ["u1", "u2"]);
  assert.deepEqual(textChunks(h.updates, "agent_message_chunk").map((chunk) => chunk.content.text), ["a1", "a2"]);
  const call = h.updates.find((update) => update.sessionUpdate === "tool_call");
  const update = h.updates.find((update) => update.sessionUpdate === "tool_call_update");
  assert.equal(call.status, "completed");
  assert.equal(call.toolCallId, "c1");
  const replayRaw = typeof call.rawInput === "string" ? call.rawInput : JSON.stringify(call.rawInput);
  assert.equal(replayRaw.includes(bigArg), false);
  assert.ok(Buffer.byteLength(replayRaw, "utf8") <= 4096);
  assert.equal(update.status, "completed");
  assert.equal(update.content[0].content.text.includes("OUTPUT_MIDDLE_SECRET"), false);
  assert.ok(Buffer.byteLength(update.content[0].content.text, "utf8") <= 2048);
  const continued = await h.ctx.request(acp.methods.agent.session.prompt, {
    sessionId: "session-saved",
    prompt: [{ type: "text", text: "next" }],
  });
  assert.equal(continued.stopReason, "end_turn");
});

test("acp: loadSession rejects unsafe ids before touching the session store", async (t) => {
  let calls = 0;
  const h = makeHarness(() => { calls += 1; return new FakeAgent("should-not-load"); });
  t.after(async () => { h.connection.close(); await h.server.shutdown(); });
  const unsafe = ["..", "../secret", "foo/bar", "foo\\bar", "/tmp/session", "C:\\session", "C:session", "%2e%2e", "%2fetc"];
  for (const sessionId of unsafe) {
    await assert.rejects(
      h.ctx.request(acp.methods.agent.session.load, {
        cwd: process.cwd(),
        mcpServers: [],
        sessionId,
      }),
      /ACP session id is invalid/,
    );
  }
  assert.equal(calls, 0);
});

test("acp: loadSession returns invalidParams when the id is not in qling's store", async (t) => {
  const fake = new FakeAgent("missing-agent", { restore: () => null });
  const h = makeHarness(() => fake);
  t.after(async () => { h.connection.close(); await h.server.shutdown(); });
  await assert.rejects(
    h.ctx.request(acp.methods.agent.session.load, {
      cwd: process.cwd(),
      mcpServers: [],
      sessionId: "session-missing",
    }),
    /ACP session was not found/,
  );
  assert.equal(fake.restoredId, "session-missing");
  assert.equal(fake.shutdownCount, 1);
  await assert.rejects(
    h.ctx.request(acp.methods.agent.session.prompt, {
      sessionId: "session-missing",
      prompt: [{ type: "text", text: "nope" }],
    }),
    /Unknown ACP session/,
  );
});

test("acp: loadSession rejects client MCP servers and additionalDirectories", async (t) => {
  let calls = 0;
  const h = makeHarness(() => { calls += 1; return new FakeAgent("nope"); });
  t.after(async () => { h.connection.close(); await h.server.shutdown(); });
  await assert.rejects(
    h.ctx.request(acp.methods.agent.session.load, {
      cwd: process.cwd(),
      mcpServers: [{ name: "x", command: process.execPath, args: [], env: [] }],
      sessionId: "session-saved",
    }),
    /MCP servers are not supported/,
  );
  await assert.rejects(
    h.ctx.request(acp.methods.agent.session.load, {
      cwd: process.cwd(),
      mcpServers: [],
      additionalDirectories: [process.cwd()],
      sessionId: "session-saved",
    }),
    /additionalDirectories are not supported/,
  );
  assert.equal(calls, 0);
});

test("acp: loadSession replays an interrupted-run reminder when the trace never completed", async (t) => {
  const fake = new FakeAgent("interrupt-agent", {
    restore: () => ({ name: "session-cut" }),
    messages: [{ role: "user", content: "old question" }],
    activeRun: { runId: "run-cut", sessionId: "session-cut" },
    trace: [{ type: "run_started" }],
  });
  const h = makeHarness(() => fake);
  t.after(async () => { h.connection.close(); await h.server.shutdown(); });
  await h.ctx.request(acp.methods.agent.session.load, {
    cwd: process.cwd(),
    mcpServers: [],
    sessionId: "session-cut",
  });
  assert.equal(fake.traceReads, 1);
  const users = textChunks(h.updates, "user_message_chunk").map((chunk) => chunk.content.text);
  assert.deepEqual(users, ["old question", INTERRUPTED_RUN_REMINDER]);
});

test("acp: loadSession does not add a second interrupted reminder", async (t) => {
  const fake = new FakeAgent("interrupt-agent-2", {
    restore: () => ({ name: "session-cut" }),
    messages: [
      { role: "user", content: "old question" },
      { role: "user", content: INTERRUPTED_RUN_REMINDER, synthetic_key: "interrupted-run-v1" },
    ],
    activeRun: { runId: "run-cut", sessionId: "session-cut" },
    trace: [{ type: "run_started" }],
  });
  const h = makeHarness(() => fake);
  t.after(async () => { h.connection.close(); await h.server.shutdown(); });
  await h.ctx.request(acp.methods.agent.session.load, {
    cwd: process.cwd(),
    mcpServers: [],
    sessionId: "session-cut-2",
  });
  const reminders = textChunks(h.updates, "user_message_chunk")
    .filter((chunk) => chunk.content.text === INTERRUPTED_RUN_REMINDER);
  assert.equal(reminders.length, 1);
  assert.equal(fake.traceReads, 0);
});

test("acp: an idle session is shut down and removed", async (t) => {
  const previous = process.env.QLING_ACP_SESSION_IDLE_MS;
  process.env.QLING_ACP_SESSION_IDLE_MS = "40";
  const fake = new FakeAgent("acp-idle");
  const h = makeHarness(() => fake);
  if (previous === undefined) delete process.env.QLING_ACP_SESSION_IDLE_MS;
  else process.env.QLING_ACP_SESSION_IDLE_MS = previous;
  t.after(async () => {
    if (previous === undefined) delete process.env.QLING_ACP_SESSION_IDLE_MS;
    else process.env.QLING_ACP_SESSION_IDLE_MS = previous;
    h.connection.close();
    await h.server.shutdown();
  });
  const created = await openSession(h);
  await waitFor(() => fake.shutdownCount === 1, 1000);
  await assert.rejects(
    h.ctx.request(acp.methods.agent.session.prompt, {
      sessionId: created.sessionId,
      prompt: [{ type: "text", text: "late" }],
    }),
    /Unknown ACP session/,
  );
});

test("acp: an active prompt keeps the session past the idle timeout", async (t) => {
  const previous = process.env.QLING_ACP_SESSION_IDLE_MS;
  process.env.QLING_ACP_SESSION_IDLE_MS = "40";
  const fake = new FakeAgent("acp-idle-active", { behavior: "pending" });
  const h = makeHarness(() => fake);
  if (previous === undefined) delete process.env.QLING_ACP_SESSION_IDLE_MS;
  else process.env.QLING_ACP_SESSION_IDLE_MS = previous;
  t.after(async () => {
    if (previous === undefined) delete process.env.QLING_ACP_SESSION_IDLE_MS;
    else process.env.QLING_ACP_SESSION_IDLE_MS = previous;
    h.connection.close();
    await h.server.shutdown();
  });
  const created = await openSession(h);
  const pending = h.ctx.request(acp.methods.agent.session.prompt, {
    sessionId: created.sessionId,
    prompt: [{ type: "text", text: "wait" }],
  });
  await waitFor(() => fake.runCount === 1);
  await delay(120);
  assert.equal(fake.shutdownCount, 0);
  await h.ctx.notify(acp.methods.agent.session.cancel, { sessionId: created.sessionId });
  assert.equal((await pending).stopReason, "cancelled");
  await waitFor(() => fake.shutdownCount === 1, 1000);
});

test("acp: stdout guard redirects console log/info/debug and leaves protocol writes alone", async (t) => {
  const stdout = [];
  const stderr = [];
  const originalOut = process.stdout.write.bind(process.stdout);
  const originalErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk, encoding, callback) => {
    stdout.push(Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk));
    if (typeof callback === "function") callback();
    return true;
  };
  process.stderr.write = (chunk, encoding, callback) => {
    stderr.push(Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk));
    if (typeof callback === "function") callback();
    return true;
  };
  const restore = installAcpStdoutGuard();
  try {
    console.log("nope-log");
    console.info("nope-info");
    console.debug("nope-debug");
    process.stdout.write("ACP-PROTOCOL\n");
    assert.equal(stdout.join("").includes("ACP-PROTOCOL"), true);
    assert.equal(stdout.join("").includes("nope-log"), false);
    assert.equal(stdout.join("").includes("nope-info"), false);
    assert.equal(stdout.join("").includes("nope-debug"), false);
    const err = stderr.join("");
    assert.equal(err.includes("nope-log"), true);
    assert.equal(err.includes("nope-info"), true);
    assert.equal(err.includes("nope-debug"), true);
  } finally {
    restore();
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  }
  t.after(() => {});
});

test("acp: runAcpStdioServer restores console methods and does not put logs on the protocol stream", async (t) => {
  const stdout = [];
  const stderr = [];
  const originalOut = process.stdout.write.bind(process.stdout);
  const originalErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk, encoding, callback) => {
    stdout.push(Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk));
    if (typeof callback === "function") callback();
    return true;
  };
  process.stderr.write = (chunk, encoding, callback) => {
    stderr.push(Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk));
    if (typeof callback === "function") callback();
    return true;
  };
  const input = new PassThrough();
  const output = new PassThrough();
  const frames = [];
  output.on("data", (chunk) => frames.push(chunk.toString()));
  const agent = new FakeAgent("stdio-unused");
  try {
    const pending = runAcpStdioServer(() => agent, { input, output });
    console.log("during-acp");
    input.end();
    await pending;
    assert.equal(frames.join("").includes("during-acp"), false);
    assert.equal(stderr.join("").includes("during-acp"), true);
    console.log("after-restore");
    assert.equal(stdout.join("").includes("after-restore"), true);
    assert.equal(stderr.join("").includes("after-restore"), false);
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  }
});
