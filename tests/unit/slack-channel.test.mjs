import test from "node:test";
import assert from "node:assert/strict";

import { SlackChannel } from "../../dist/channels/slack-channel.js";

test("slack channel: requestApproval without target channel auto-denies", async () => {
  const channel = new SlackChannel({
    botToken: "xoxb-test",
    channelIds: [],
    pollIntervalMs: 1000,
  });

  const response = await channel.requestApproval({
    id: "req-1",
    toolName: "bash",
    arguments: { command: "rm -rf /tmp" },
    reason: "dangerous command",
    timestamp: Date.now(),
  });

  assert.equal(response.requestId, "req-1");
  assert.equal(response.decision, "deny");
});

test("slack channel: pending approvals are routed by id without overriding message handler", async () => {
  const channel = new SlackChannel({
    botToken: "xoxb-test",
    channelIds: ["C1"],
    pollIntervalMs: 1000,
  });

  // Avoid real network calls in unit test
  channel.apiCall = async () => ({ ok: true });

  let forwarded = "";
  channel.onUserMessage(async (msg) => {
    forwarded = msg;
  });

  try {
    const p1 = channel.requestApproval({
      id: "aaaaaaaa-1111-2222-3333-444444444444",
      toolName: "read",
      arguments: { path: "README.md" },
      reason: "confirm read",
      timestamp: Date.now(),
    });
    const p2 = channel.requestApproval({
      id: "bbbbbbbb-1111-2222-3333-555555555555",
      toolName: "write",
      arguments: { path: "out.txt" },
      reason: "confirm write",
      timestamp: Date.now(),
    });

    for (let i = 0; i < 20 && channel.pendingApprovals.size < 2; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    assert.equal(channel.tryHandleApprovalText("allow aaaaaaaa"), true);
    assert.equal(channel.tryHandleApprovalText("deny bbbbbbbb"), true);

    const r1 = await p1;
    const r2 = await p2;

    assert.equal(r1.requestId, "aaaaaaaa-1111-2222-3333-444444444444");
    assert.equal(r1.decision, "allow");
    assert.equal(r2.requestId, "bbbbbbbb-1111-2222-3333-555555555555");
    assert.equal(r2.decision, "deny");

    await channel.userMessageHandler("hello-from-user");
    assert.equal(forwarded, "hello-from-user");
  } finally {
    await channel.stop();
  }
});
