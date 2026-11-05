import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuntimeEventJournal } from "../../dist/runtime/event-journal.js";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";

test("pre-durability journal checksums survive schema upgrade and reopening", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-journal-upgrade-"));
  let journal;
  try {
    const db = new Database(join(dir, "runtime.db"));
    db.exec(`CREATE TABLE runtime_events (
      session_id TEXT NOT NULL, sequence INTEGER NOT NULL, event_id TEXT NOT NULL,
      run_id TEXT, turn_id TEXT, causation_id TEXT, type TEXT NOT NULL,
      timestamp INTEGER NOT NULL, payload TEXT NOT NULL, checksum TEXT NOT NULL,
      PRIMARY KEY (session_id, sequence), UNIQUE (event_id))`);
    const event = { eventId: "old-1", sequence: 1, sessionId: "s1", type: "note", timestamp: 123, payload: { message: "preserve" } };
    const hash = createHash("sha256").update(JSON.stringify(event)).digest("hex");
    db.prepare("INSERT INTO runtime_events VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?)")
      .run("s1", 1, "old-1", event.type, event.timestamp, JSON.stringify(event.payload), hash);
    db.close();
    for (let i = 0; i < 2; i++) {
      journal = new RuntimeEventJournal({ stateDir: dir, sessionId: "s1" });
      await journal.init();
      const events = await journal.replay(0);
      assert.equal(events.length, 1);
      assert.deepEqual(events[0].payload, event.payload);
      assert.equal(events[0].durability, "buffered");
      journal.close();
    }
  } finally {
    journal?.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("durable events are persisted separately from buffered events", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-journal-durable-"));
  try {
    const journal = new RuntimeEventJournal({ stateDir: dir, sessionId: "s1" });
    await journal.init();
    await journal.append({ type: "note", payload: { ok: true } });
    const durable = await journal.append({
      type: "approval_decided",
      payload: { decision: "allow" },
      durability: "durable",
    });
    assert.equal(durable.durability, "durable");

    const outcome = await journal.appendWithOutcome({
      type: "prompt_completed",
      payload: { status: "done" },
      durability: "durable",
    });
    assert.equal(outcome.status, "committed");
    assert.ok(["ok", "busy"].includes(outcome.checkpoint), "checkpoint result must be classified");

    const restored = await journal.restore();
    assert.equal(restored.events.length, 3);
    assert.equal(restored.events[0].durability, "buffered");
    assert.equal(restored.events[1].durability, "durable");
    assert.equal(restored.events[2].durability, "durable");
    journal.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
