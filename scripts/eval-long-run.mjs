import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { RuntimeEventJournal } from "../dist/runtime/event-journal.js";
import { SessionActor } from "../dist/runtime/session-actor.js";

const dir = await mkdtemp(path.join(tmpdir(), "qling-eval-long-"));
const journal = new RuntimeEventJournal({ stateDir: dir, sessionId: "long-run" });
await journal.init();
const seen = [];
const actor = new SessionActor({ sessionId: "long-run", journal, snapshotEveryEvents: 5, executePrompt: async ({ prompt }) => { seen.push(prompt); return { status: "completed", text: prompt }; } });
try {
  await Promise.all(Array.from({ length: 50 }, (_, i) => actor.dispatch({ type: "submit_prompt", prompt: `turn-${i}` })));
  await actor.waitForIdle();
  assert.equal(new Set(seen).size, 50);
  assert.equal(actor.getSnapshot().promptQueue.length, 0);
  console.log(JSON.stringify({ eval: "long-run", passed: 2, turns: seen.length, events: (await journal.replay()).length }));
} finally {
  await actor.close();
  await journal.close();
  await rm(dir, { recursive: true, force: true });
}
