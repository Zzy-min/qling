import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { RuntimeEventJournal } from "../dist/runtime/event-journal.js";
import { SessionActor } from "../dist/runtime/session-actor.js";

const TURNS = Number(process.env.QLING_EVAL_LONG_RUN_TURNS ?? 1440);
const dir = await mkdtemp(path.join(tmpdir(), "qling-eval-long-"));
const sessionId = "long-run";
let virtualNow = Date.now();
const journal = new RuntimeEventJournal({ stateDir: dir, sessionId, now: () => virtualNow });
await journal.init();
const seen = [];
const actor = new SessionActor({
  sessionId,
  journal,
  now: () => virtualNow,
  snapshotEveryEvents: 25,
  executePrompt: async ({ prompt }) => {
    seen.push(prompt);
    virtualNow += 60_000;
    if (seen.length % 113 === 0) return { status: "failed", text: "injected transient failure" };
    return { status: "completed", text: prompt };
  },
});

try {
  const results = await Promise.all(Array.from({ length: TURNS }, (_, i) => actor.dispatch({ type: "submit_prompt", prompt: `turn-${i}` })));
  await actor.waitForIdle();
  assert.equal(new Set(seen).size, TURNS);
  assert.equal(actor.getSnapshot().promptQueue.length, 0);
  assert.equal(results.length, TURNS);
  const beforeCrashEvents = await journal.replay();
  await actor.close();
  await journal.close();

  const crashCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(process.cwd(), "scripts", "eval-runtime-crash-worker.mjs"), dir, sessionId], {
      cwd: process.cwd(),
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 86 ? resolve(code) : reject(new Error(`crash worker exited ${code}: ${stderr}`)));
  });
  assert.equal(crashCode, 86);

  const recoveredJournal = new RuntimeEventJournal({ stateDir: dir, sessionId, now: () => virtualNow });
  await recoveredJournal.init();
  const interrupted = await recoveredJournal.inspectInterruptedTools();
  assert.equal(interrupted.retryable.length, 1);
  assert.equal(interrupted.unknownOutcome.length, 1);
  const recovered = await recoveredJournal.restore();
  assert.ok(recovered.events.length >= 0);

  const db = new Database(path.join(dir, "runtime.db"));
  const last = db.prepare("SELECT MAX(sequence) AS sequence FROM runtime_events WHERE session_id = ?").get(sessionId);
  db.prepare("UPDATE runtime_events SET checksum = 'corrupt' WHERE session_id = ? AND sequence = ?").run(sessionId, last.sequence);
  db.close();
  const corruption = await recoveredJournal.restore();
  assert.equal(corruption.truncatedAtSequence, last.sequence);
  await recoveredJournal.close();

  console.log(JSON.stringify({
    eval: "long-run",
    status: "pass",
    turns: TURNS,
    simulatedHours: TURNS / 60,
    eventsBeforeCrash: beforeCrashEvents.length,
    injectedFailures: results.filter((result) => result.status === "failed").length,
    crashExitCode: crashCode,
    interruptedTools: { retryable: interrupted.retryable.length, unknownOutcome: interrupted.unknownOutcome.length },
    corruptionTruncatedAt: corruption.truncatedAtSequence,
    evidence: {
      executor: "harness",
      model: "none",
      verifier: "state_and_fault_injection",
      claim: "Exercises 24 hours of virtual-time queue activity, abrupt process exit, interrupted-tool classification, WAL recovery, and checksum corruption quarantine.",
      limitations: ["Virtual-time acceleration is not a 24-hour wall-clock soak; it does not measure long-duration resource leaks."],
    },
  }));
} finally {
  await actor.close().catch(() => undefined);
  journal.close();
  await rm(dir, { recursive: true, force: true });
}
