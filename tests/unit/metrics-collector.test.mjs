// ============================================================
// Metrics Collector 单元测试
// ============================================================

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { MetricsCollector } from "../../dist/metrics/collector.js";

let tmpDir;

before(async () => {
  tmpDir = path.join(os.tmpdir(), "ql-test-metrics-" + Date.now());
  await fs.mkdir(tmpDir, { recursive: true });
});

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("MetricsCollector", () => {
  it("should record events", async () => {
    const collector = new MetricsCollector(tmpDir, "test-session");
    await collector.init();

    collector.record({ type: "turn_complete", data: { turn: 1, toolCalls: 3 } });
    collector.record({ type: "tool_call", data: { toolName: "bash" } });

    await collector.flush();

    const events = await collector.query({});
    assert.equal(events.length, 2);
    assert.equal(events[0].type, "turn_complete");
    assert.equal(events[0].session_id, "test-session");
    assert.equal(events[1].type, "tool_call");
  });

  it("should query by type", async () => {
    const collector = new MetricsCollector(tmpDir, "session-query-type");
    await collector.init();

    collector.record({ type: "turn_complete", data: {} });
    collector.record({ type: "tool_error", data: { toolName: "bash" } });
    collector.record({ type: "turn_complete", data: {} });

    await collector.flush();

    const events = await collector.query({ type: "turn_complete", session_id: "session-query-type" });
    assert.equal(events.length, 2);
  });

  it("should query by session_id", async () => {
    const collector = new MetricsCollector(tmpDir, "session-3");
    await collector.init();

    collector.record({ type: "session_start", data: {} });
    await collector.flush();

    const events = await collector.query({ session_id: "session-3" });
    assert.equal(events.length, 1);
    const none = await collector.query({ session_id: "nonexistent" });
    assert.equal(none.length, 0);
  });

  it("should query with limit", async () => {
    const collector = new MetricsCollector(tmpDir, "session-limit");
    await collector.init();

    for (let i = 0; i < 5; i++) {
      collector.record({ type: "turn_complete", data: { turn: i } });
    }
    await collector.flush();

    const events = await collector.query({ limit: 3, session_id: "session-limit" });
    assert.equal(events.length, 3);
  });

  it("should handle empty directory", async () => {
    const emptyDir = path.join(tmpDir, "empty");
    await fs.mkdir(emptyDir, { recursive: true });
    const collector = new MetricsCollector(emptyDir, "test");
    await collector.init();
    const events = await collector.query({});
    assert.deepEqual(events, []);
  });

  it("should auto-flush when buffer reaches 100", async () => {
    const collector = new MetricsCollector(tmpDir, "session-autoflush");
    await collector.init();

    for (let i = 0; i < 110; i++) {
      collector.record({ type: "turn_complete", data: { turn: i } });
    }
    // auto-flush should have been triggered at 100

    const events = await collector.query({ session_id: "session-autoflush" });
    assert.ok(events.length >= 100, "auto-flush should have written at least 100 events");
  });
});
