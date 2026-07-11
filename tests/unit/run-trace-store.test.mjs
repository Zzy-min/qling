import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RunTraceStore } from "../../dist/execution/run-trace-store.js";

test("run trace store persists only the redacted event allowlist", async () => {
  const root = await mkdtemp(join(tmpdir(), "qling-trace-"));
  try {
    const store = new RunTraceStore({ rootDir: root, now: () => 100 });
    await store.append({
      eventId: "evt_1", runId: "run_1", sessionId: "session_1", attemptId: "attempt_1",
      type: "failure", timestamp: 100, stage: "tool", status: "paused", tool: "bash",
      category: "tool_execution", fingerprint: "abc", durationMs: 12,
      progress: { changed: false }, recoveryAction: "pause",
      prompt: "SECRET_PROMPT", output: "SECRET_TOOL_OUTPUT", privateMarker: "DO_NOT_PERSIST_MARKER",
    });

    const path = store.getRunPath("session_1", "run_1");
    const raw = await readFile(path, "utf8");
    assert.doesNotMatch(raw, /SECRET_PROMPT|SECRET_TOOL_OUTPUT|DO_NOT_PERSIST_MARKER/);
    assert.match(raw, /\"fingerprint\":\"abc\"/);
    assert.equal((await store.readRun("session_1", "run_1")).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("run trace store reads recent events with a bounded tail scan", async () => {
  const root = await mkdtemp(join(tmpdir(), "qling-trace-tail-"));
  try {
    const store = new RunTraceStore({ rootDir: root });
    for (let index = 0; index < 200; index++) {
      await store.append({
        eventId: `evt_${index}`, runId: "run_tail", sessionId: "session_tail",
        type: "attempt", timestamp: index, status: "running", fingerprint: `fp_${index}`,
      });
    }
    const result = await store.queryRecent("session_tail", "run_tail", { limit: 5, maxScanBytes: 1_024 });
    assert.equal(result.events.length, 5);
    assert.equal(result.events.at(-1).eventId, "evt_199");
    assert.ok(result.scannedBytes <= 1_024);
    assert.equal(result.truncated, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("run trace store queries the latest 50 of 10000 events below 200ms", async () => {
  const root = await mkdtemp(join(tmpdir(), "qling-trace-perf-"));
  try {
    const store = new RunTraceStore({ rootDir: root });
    const file = store.getRunPath("session_perf", "run_perf");
    await mkdir(join(root, "session_perf"), { recursive: true });
    const lines = Array.from({ length: 10_000 }, (_, index) => JSON.stringify({
      eventId: `evt_${index}`, runId: "run_perf", sessionId: "session_perf",
      type: "attempt", timestamp: index, status: "running", fingerprint: `fp_${index}`,
    })).join("\n") + "\n";
    await writeFile(file, lines, "utf8");

    const startedAt = performance.now();
    const result = await store.queryRecent("session_perf", "run_perf", { limit: 50, maxScanBytes: 1024 * 1024 });
    const durationMs = performance.now() - startedAt;
    assert.equal(result.events.length, 50);
    assert.equal(result.events.at(-1).eventId, "evt_9999");
    assert.ok(durationMs < 200, `query took ${durationMs.toFixed(1)}ms`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
