import test from "node:test";
import assert from "node:assert/strict";
import * as acp from "@agentclientprotocol/sdk";

import { QlingAcpServer } from "../../dist/cli/acp-server.js";

class FakeAgent {
  constructor(id, behavior = "complete") {
    this.id = id;
    this.behavior = behavior;
    this.messages = [];
    this.plan = false;
    this.permission = "ask";
    this.listener = () => {};
    this.channel = null;
    this.cancelReject = null;
    this.shutdownCount = 0;
  }
  async waitForInit() {}
  getSessionId() { return this.id; }
  addUserMessage(content) { this.messages.push(content); }
  setChannel(channel) { this.channel = channel; }
  setPlanMode(enabled) { this.plan = enabled; }
  setPermissionMode(mode) { this.permission = mode; }
  subscribeExecutionEvents(listener) { this.listener = listener; return () => { this.listener = () => {}; }; }
  async run() {
    if (this.behavior === "pending") {
      return new Promise((_resolve, reject) => { this.cancelReject = reject; });
    }
    this.listener({
      eventId: "e1", runId: "r1", sessionId: this.id, attemptId: "a1",
      toolCallId: "tool-1", type: "tool_started", timestamp: Date.now(),
      status: "running", tool: "read_file",
    });
    const approval = await this.channel.requestApproval({
      id: "approval-1", toolName: "write", arguments: { path: "README.md" },
      reason: "workspace change", timestamp: Date.now(),
    });
    this.listener({
      eventId: "e2", runId: "r1", sessionId: this.id, attemptId: "a1",
      toolCallId: "tool-1", type: "tool_completed", timestamp: Date.now(),
      status: "succeeded", tool: "read_file",
    });
    return `answer:${approval.decision}`;
  }
  cancelActiveRun() {
    if (!this.cancelReject) return false;
    const error = new Error("Agent run canceled");
    error.name = "AgentRunCanceledError";
    this.cancelReject(error);
    this.cancelReject = null;
    return true;
  }
  async shutdown() { this.shutdownCount++; }
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

test("acp: initialize advertises only implemented baseline capabilities", async (t) => {
  const fake = new FakeAgent("acp-init");
  const h = makeHarness(() => fake);
  t.after(async () => { h.connection.close(); await h.server.shutdown(); });
  const result = await h.ctx.request(acp.methods.agent.initialize, {
    protocolVersion: acp.PROTOCOL_VERSION,
    clientCapabilities: {},
  });
  assert.equal(result.protocolVersion, acp.PROTOCOL_VERSION);
  assert.equal(result.agentInfo.name, "qling");
  assert.deepEqual(result.agentCapabilities.promptCapabilities, {});
  assert.equal(result.agentCapabilities.loadSession, false);
  assert.equal(result.agentCapabilities.mcpCapabilities, undefined);
});

test("acp: session maps cwd, modes, resources, tools and approvals", async (t) => {
  const fake = new FakeAgent("acp-session");
  let receivedCwd = "";
  const h = makeHarness((cwd) => { receivedCwd = cwd; return fake; });
  t.after(async () => { h.connection.close(); await h.server.shutdown(); });
  const created = await h.ctx.request(acp.methods.agent.session.new, {
    cwd: process.cwd(), mcpServers: [],
  });
  assert.equal(created.sessionId, "acp-session");
  assert.equal(receivedCwd, process.cwd());
  assert.equal(created.modes.currentModeId, "normal");
  assert.equal(fake.permission, "ask");

  await h.ctx.request(acp.methods.agent.session.setMode, {
    sessionId: created.sessionId, modeId: "plan",
  });
  assert.equal(fake.plan, true);
  assert.equal(fake.permission, "ask");

  const result = await h.ctx.request(acp.methods.agent.session.prompt, {
    sessionId: created.sessionId,
    prompt: [
      { type: "text", text: "inspect" },
      { type: "resource_link", name: "README", uri: "file:///README.md" },
    ],
  });
  assert.equal(result.stopReason, "end_turn");
  assert.match(fake.messages[0], /inspect/);
  assert.match(fake.messages[0], /\[Resource: README\] file:\/\/\/README\.md/);
  assert.equal(h.permissions.length, 1);
  assert.deepEqual(h.updates.map((update) => update.sessionUpdate), [
    "tool_call", "tool_call_update", "agent_message_chunk",
  ]);
  assert.equal(h.updates.at(-1).content.text, "answer:allow");
});

test("acp: rejects unimplemented client MCP injection instead of ignoring it", async (t) => {
  const h = makeHarness(() => new FakeAgent("unused"));
  t.after(async () => { h.connection.close(); await h.server.shutdown(); });
  await assert.rejects(
    h.ctx.request(acp.methods.agent.session.new, {
      cwd: process.cwd(),
      mcpServers: [{ name: "x", command: process.execPath, args: [], env: [] }],
    }),
    /MCP servers are not supported/,
  );
});

test("acp: session cancel stops an active prompt with cancelled stop reason", async (t) => {
  const fake = new FakeAgent("acp-cancel", "pending");
  const h = makeHarness(() => fake);
  t.after(async () => { h.connection.close(); await h.server.shutdown(); });
  const created = await h.ctx.request(acp.methods.agent.session.new, {
    cwd: process.cwd(), mcpServers: [],
  });
  const pending = h.ctx.request(acp.methods.agent.session.prompt, {
    sessionId: created.sessionId,
    prompt: [{ type: "text", text: "wait" }],
  });
  await new Promise((resolve) => setImmediate(resolve));
  await h.ctx.notify(acp.methods.agent.session.cancel, { sessionId: created.sessionId });
  assert.equal((await pending).stopReason, "cancelled");
});
