import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { RuntimeEventJournal } from "../../dist/runtime/event-journal.js";
import { SessionActor } from "../../dist/runtime/session-actor.js";
import { projectSessionEvents } from "../../dist/runtime/session-projector.js";

async function tempStateDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "qling-runtime-"));
}

test("session actor serializes prompts and emits deterministic envelopes", async () => {
  const stateDir = await tempStateDir();
  const journal = new RuntimeEventJournal({ stateDir, sessionId: "session-order", now: () => 100 });
  await journal.init();
  const releases = [];
  const seen = [];
  const actor = new SessionActor({
    sessionId: "session-order",
    journal,
    executePrompt: async ({ prompt }) => {
      seen.push(`start:${prompt}`);
      await new Promise((resolve) => releases.push(resolve));
      seen.push(`end:${prompt}`);
      return { status: "completed", text: prompt.toUpperCase() };
    },
  });

  const first = actor.dispatch({ type: "submit_prompt", prompt: "first" });
  const second = actor.dispatch({ type: "submit_prompt", prompt: "second" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(seen, ["start:first"]);
  assert.equal(actor.getSnapshot().state, "running");
  assert.equal(actor.getSnapshot().promptQueue.length, 1);

  releases.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(seen, ["start:first", "end:first", "start:second"]);
  releases.shift()();
  await Promise.all([first, second]);

  const events = await journal.replay();
  assert.deepEqual(events.map((event) => event.sequence), events.map((_, index) => index + 1));
  assert.equal(actor.getSnapshot().state, "idle");
  assert.deepEqual(seen, ["start:first", "end:first", "start:second", "end:second"]);
  await actor.close();
});

test("interjection runs at the next safe boundary before normal queued prompts", async () => {
  const stateDir = await tempStateDir();
  const journal = new RuntimeEventJournal({ stateDir, sessionId: "session-interject" });
  await journal.init();
  const gate = [];
  const seen = [];
  const actor = new SessionActor({
    sessionId: "session-interject",
    journal,
    executePrompt: async ({ prompt, priority }) => {
      seen.push(`${priority}:${prompt}`);
      if (seen.length === 1) await new Promise((resolve) => gate.push(resolve));
      return { status: "completed", text: prompt };
    },
  });

  const active = actor.dispatch({ type: "submit_prompt", prompt: "active" });
  const queued = actor.dispatch({ type: "submit_prompt", prompt: "queued" });
  const urgent = actor.dispatch({ type: "interject", prompt: "urgent" });
  await new Promise((resolve) => setImmediate(resolve));
  gate.shift()();
  await Promise.all([active, queued, urgent]);

  assert.deepEqual(seen, ["normal:active", "interjection:urgent", "normal:queued"]);
  await actor.close();
});

test("journal restores the last valid snapshot and stops at a corrupt event", async () => {
  const stateDir = await tempStateDir();
  const journal = new RuntimeEventJournal({ stateDir, sessionId: "session-replay" });
  await journal.init();
  await journal.append({ type: "state_changed", payload: { state: "running" } });
  await journal.saveSnapshot({
    sessionId: "session-replay",
    state: "running",
    sequence: 1,
    promptQueue: [],
    activeRun: null,
    pendingApproval: null,
    activeTools: [],
    recentEvidence: [],
    budget: {},
    updatedAt: 10,
  });
  await journal.append({ type: "state_changed", payload: { state: "idle" } });
  await journal.injectCorruptEventForTest({ sequence: 3, checksum: "invalid" });

  const restored = await journal.restore();
  assert.equal(restored.snapshot.state, "running");
  assert.equal(restored.events.length, 1);
  assert.equal(restored.events[0].sequence, 2);
  assert.equal(restored.truncatedAtSequence, 3);
  journal.close();
});

test("restored unconfirmed mutating tool pauses while read-only work remains retryable", async () => {
  const stateDir = await tempStateDir();
  const journal = new RuntimeEventJournal({ stateDir, sessionId: "session-unknown" });
  await journal.init();
  await journal.recordToolCall({
    toolCallId: "write-1",
    tool: "write",
    argumentsHash: "abc",
    sideEffect: "workspace",
    idempotent: false,
    status: "running",
  });
  await journal.recordToolCall({
    toolCallId: "read-1",
    tool: "read",
    argumentsHash: "def",
    sideEffect: "none",
    idempotent: true,
    status: "running",
  });

  const recovery = await journal.inspectInterruptedTools();
  assert.deepEqual(recovery.retryable.map((item) => item.toolCallId), ["read-1"]);
  assert.deepEqual(recovery.unknownOutcome.map((item) => item.toolCallId), ["write-1"]);
  journal.close();
});

test("restored queued prompts are rehydrated and execute exactly once on resume", async () => {
  const stateDir = await tempStateDir();
  const journal = new RuntimeEventJournal({ stateDir, sessionId: "session-queue-recovery", now: () => 500 });
  await journal.init();
  const snapshot = {
    sessionId: "session-queue-recovery",
    state: "paused",
    sequence: 0,
    promptQueue: [{ id: "recovered-1", prompt: "continue work", priority: "normal", queuedAt: 100 }],
    activeRun: null,
    pendingApproval: null,
    activeTools: [],
    recentEvidence: [],
    budget: {},
    updatedAt: 100,
  };
  const seen = [];
  const actor = new SessionActor({
    sessionId: "session-queue-recovery",
    journal,
    initialSnapshot: snapshot,
    executePrompt: async ({ prompt }) => {
      seen.push(prompt);
      return { status: "completed", text: "done" };
    },
  });

  assert.equal(actor.getSnapshot().promptQueue.length, 1);
  await actor.dispatch({ type: "resume_session" });
  await actor.waitForIdle();
  assert.deepEqual(seen, ["continue work"]);
  assert.equal(actor.getSnapshot().promptQueue.length, 0);
  await actor.close();
  journal.close();
});

test("a trusted queued snapshot resumes draining without another prompt", async () => {
  const stateDir = await tempStateDir();
  const journal = new RuntimeEventJournal({ stateDir, sessionId: "session-trusted-queue" });
  await journal.init();
  const seen = [];
  const actor = new SessionActor({
    sessionId: "session-trusted-queue",
    journal,
    initialSnapshot: {
      sessionId: "session-trusted-queue",
      state: "queued",
      sequence: 0,
      promptQueue: [{ id: "queued-1", prompt: "queued work", priority: "normal", queuedAt: 1 }],
      activeRun: null,
      pendingApproval: null,
      activeTools: [],
      recentEvidence: [],
      budget: {},
      updatedAt: 1,
    },
    executePrompt: async ({ prompt }) => {
      seen.push(prompt);
      return { status: "completed", text: "done" };
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  await actor.waitForIdle();
  assert.deepEqual(seen, ["queued work"]);
  assert.equal(actor.getSnapshot().state, "idle");
  await actor.close();
  journal.close();
});

test("active shutdown joins the drain before the journal can be closed", async () => {
  const stateDir = await tempStateDir();
  const journal = new RuntimeEventJournal({ stateDir, sessionId: "session-active-close" });
  await journal.init();
  const actor = new SessionActor({
    sessionId: "session-active-close",
    journal,
    executePrompt: async ({ signal }) => {
      await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      return { status: "canceled", text: "aborted" };
    },
  });
  const running = actor.dispatch({ type: "submit_prompt", prompt: "long work" });
  await new Promise((resolve) => setImmediate(resolve));
  await actor.close();
  journal.close();
  assert.equal((await running).status, "canceled");
});

test("completion snapshot cannot retain an active run for crash recovery", async () => {
  const stateDir = await tempStateDir();
  const journal = new RuntimeEventJournal({ stateDir, sessionId: "session-complete-snapshot" });
  await journal.init();
  const actor = new SessionActor({
    sessionId: "session-complete-snapshot",
    journal,
    snapshotEveryEvents: 1,
    executePrompt: async () => ({ status: "completed", text: "done" }),
  });
  await actor.dispatch({ type: "submit_prompt", prompt: "write once" });
  const restored = await journal.restore();
  assert.equal(restored.snapshot.activeRun, null);
  assert.equal(restored.snapshot.promptQueue.length, 0);
  await actor.close();
  journal.close();
});

test("journal allocates monotonic sequences across overlapping owners", async () => {
  const stateDir = await tempStateDir();
  const first = new RuntimeEventJournal({ stateDir, sessionId: "session-two-owners" });
  const second = new RuntimeEventJournal({ stateDir, sessionId: "session-two-owners" });
  await first.init();
  await second.init();
  const one = await first.append({ type: "one" });
  const two = await second.append({ type: "two" });
  assert.deepEqual([one.sequence, two.sequence], [1, 2]);
  first.close();
  second.close();
});

test("failed and canceled turns do not strand later queued prompts", async () => {
  for (const terminal of ["failed", "canceled"]) {
    const stateDir = await tempStateDir();
    const journal = new RuntimeEventJournal({ stateDir, sessionId: `session-after-${terminal}` });
    await journal.init();
    let calls = 0;
    const actor = new SessionActor({
      sessionId: `session-after-${terminal}`,
      journal,
      executePrompt: async ({ prompt }) => {
        calls++;
        return calls === 1 ? { status: terminal, text: terminal } : { status: "completed", text: prompt };
      },
    });
    assert.equal((await actor.dispatch({ type: "submit_prompt", prompt: "first" })).status, terminal);
    assert.equal((await actor.dispatch({ type: "submit_prompt", prompt: "second" })).text, "second");
    assert.equal(actor.getSnapshot().state, "idle");
    await actor.close();
    await journal.close();
  }
});

test("session event projector restores prompts queued after the last snapshot", () => {
  const base = {
    sessionId: "projector",
    state: "idle",
    sequence: 1,
    promptQueue: [],
    activeRun: null,
    pendingApproval: null,
    activeTools: [],
    recentEvidence: [],
    budget: {},
    updatedAt: 1,
  };
  const projected = projectSessionEvents(base, [{
    eventId: "event-2",
    sequence: 2,
    sessionId: "projector",
    type: "prompt_queued",
    timestamp: 2,
    payload: { promptId: "p2", prompt: "recover me", priority: "normal", pendingCount: 1 },
  }]);
  assert.equal(projected.state, "queued");
  assert.equal(projected.promptQueue[0].prompt, "recover me");
  assert.equal(projected.sequence, 2);
});

test("session event projector preserves paused state when a prompt was queued before crash", () => {
  const base = {
    sessionId: "projector-paused", state: "paused", sequence: 1, promptQueue: [], activeRun: null,
    pendingApproval: null, activeTools: [], recentEvidence: [], budget: {}, pauseReason: "confirm mutation", updatedAt: 1,
  };
  const projected = projectSessionEvents(base, [{
    eventId: "event-2", sequence: 2, sessionId: "projector-paused", type: "prompt_queued", timestamp: 2,
    payload: { promptId: "p2", prompt: "wait for confirmation", priority: "normal", pendingCount: 1 },
  }]);
  assert.equal(projected.state, "paused");
  assert.equal(projected.promptQueue.length, 1);
});

test("session event projector consumes a real queued-started-completed actor sequence", async () => {
  const stateDir = await tempStateDir();
  const journal = new RuntimeEventJournal({ stateDir, sessionId: "projector-real" });
  await journal.init();
  const actor = new SessionActor({
    sessionId: "projector-real",
    journal,
    snapshotEveryEvents: 100,
    executePrompt: async ({ prompt }) => ({ status: "completed", text: prompt }),
  });
  const empty = actor.getSnapshot();
  await actor.dispatch({ type: "submit_prompt", prompt: "do once" });
  const projected = projectSessionEvents(empty, await journal.replay());
  assert.equal(projected.state, "idle");
  assert.equal(projected.promptQueue.length, 0);
  assert.equal(projected.activeRun, null);
  await actor.close();
  await journal.close();
});
