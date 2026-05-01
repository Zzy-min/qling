// ============================================================
// Channel Registry 单元测试
// ============================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ChannelRegistry } from "../../dist/channels/registry.js";

class MockChannel {
  name;
  started = false;
  stopped = false;
  constructor(name) { this.name = name; }
  started = false;
  stopped = false;
  async start() { this.started = true; }
  async stop() { this.stopped = true; }
  async sendText() {}
  async sendToolStart() {}
  async sendToolResult() {}
  async sendError() {}
  onUserMessage() {}
  async requestApproval() { return { requestId: "1", decision: "allow", timestamp: Date.now() }; }
}

describe("ChannelRegistry", () => {
  it("should register and get channels", () => {
    const reg = new ChannelRegistry();
    const ch = new MockChannel("console");
    reg.register(ch);

    assert.equal(reg.get("console"), ch);
    assert.equal(reg.get("missing"), undefined);
  });

  it("should list all channels", () => {
    const reg = new ChannelRegistry();
    reg.register(new MockChannel("console"));
    reg.register(new MockChannel("telegram"));

    assert.equal(reg.getAll().length, 2);
  });

  it("should start and stop all", async () => {
    const reg = new ChannelRegistry();
    const ch1 = new MockChannel("console");
    const ch2 = new MockChannel("telegram");
    reg.register(ch1);
    reg.register(ch2);

    await reg.startAll();
    assert.ok(ch1.started);
    assert.ok(ch2.started);

    await reg.stopAll();
    assert.ok(ch1.stopped);
    assert.ok(ch2.stopped);
  });
});
