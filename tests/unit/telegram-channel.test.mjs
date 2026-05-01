import test from "node:test";
import assert from "node:assert/strict";

import { TelegramChannel } from "../../dist/channels/telegram-channel.js";

test("telegram channel: requestApproval without target chat auto-denies", async () => {
  const channel = new TelegramChannel({
    token: "fake-token",
    allowedChatIds: [],
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

test("telegram channel: sendText without target chat is no-op", async () => {
  const channel = new TelegramChannel({
    token: "fake-token",
    allowedChatIds: [],
    pollIntervalMs: 1000,
  });

  await assert.doesNotReject(async () => {
    await channel.sendText("hello");
  });
});
