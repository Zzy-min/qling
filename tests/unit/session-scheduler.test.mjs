import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { SessionScheduler } from "../../dist/session/session-scheduler.js";

for (const cancelAll of [false, true]) for (const fails of [false, true]) {
  test(`scheduler preserves another instance's ${cancelAll ? "bulk " : ""}cancellation after callback ${fails ? "failure" : "success"}`, async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-scheduler-cancel-race-"));
    let now = 1_000;
    let entered, release;
    const started = new Promise((resolve) => { entered = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });
    const first = new SessionScheduler({ stateDir, sessionId: "shared", clock: () => now,
      onDue: async () => { entered(); await gate; if (fails) throw new Error("late failure"); } });
    await first.init();
    const task = await first.createLoopTask({ prompt: "fixture", intervalMs: 1_000, mode: "fixed" });
    now = 2_001;
    const running = first.runDueTasksOnce();
    try {
      await started;
      const second = new SessionScheduler({ stateDir, sessionId: "shared", clock: () => now });
      await second.init();
      if (cancelAll) await second.cancelAllTasks();
      else await second.cancelTask(task.id);
      // New tasks must not be lost when the old owner's completion settles.
      const added = await second.createLoopTask({ prompt: "new fixture", intervalMs: 1_000, mode: "fixed" });
      release();
      await running;
      const tasks = await second.listTasks();
      assert.equal(tasks.find((item) => item.id === task.id).status, "canceled");
      assert.ok(tasks.some((item) => item.id === added.id));
    } finally {
      release();
      await running;
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });
}

test("scheduler never reclaims an incomplete claim during its initialization window", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-scheduler-partial-claim-"));
  try {
    let now = 1_000;
    let calls = 0;
    const scheduler = new SessionScheduler({ stateDir, sessionId: "partial", clock: () => now,
      onDue: async () => { calls++; } });
    await scheduler.init();
    const task = await scheduler.createLoopTask({ prompt: "fixture", intervalMs: 1_000, mode: "fixed" });
    const claims = path.join(stateDir, "session-tasks", "claims");
    await fs.mkdir(claims, { recursive: true });
    const claim = path.join(claims, `${task.id}.claim`);
    await fs.writeFile(claim, "", { flag: "wx" });
    now = 2_001;
    assert.equal((await scheduler.runDueTasksOnce()).triggered, 0);
    assert.equal(calls, 0);
    assert.equal(await fs.readFile(claim, "utf8"), "", "unreadable is not permission to delete another claim");
    assert.equal((await scheduler.listTasks())[0].status, "blocked");
    await scheduler.reconcileTask(task.id);
    assert.equal((await scheduler.runDueTasksOnce()).triggered, 1);
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test("scheduler state updates preserve tasks created by separate processes", { timeout: 20_000 }, async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-scheduler-processes-"));
  const moduleUrl = new URL("../../dist/session/session-scheduler.js", import.meta.url).href;
  const worker = `
    const { SessionScheduler } = await import(process.argv[1]);
    const scheduler = new SessionScheduler({ stateDir: process.argv[2], sessionId: "processes" });
    await scheduler.init();
    for (let i = 0; i < 10; i++) {
      await scheduler.createLoopTask({ prompt: process.argv[3] + ":" + i, intervalMs: 1000, mode: "fixed" });
    }
  `;
  try {
    await Promise.all(["left", "right"].map((label) => run(process.execPath,
      ["--input-type=module", "-e", worker, moduleUrl, stateDir, label], { timeout: 15_000 })));
    const scheduler = new SessionScheduler({ stateDir, sessionId: "processes" });
    await scheduler.init();
    const tasks = await scheduler.listTasks();
    assert.equal(tasks.length, 20);
    assert.equal(new Set(tasks.map((task) => task.prompt)).size, 20);
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test("cross-process cancellation survives the running process's settlement", { timeout: 20_000 }, async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-scheduler-process-cancel-"));
  const moduleUrl = new URL("../../dist/session/session-scheduler.js", import.meta.url).href;
  let running;
  let childError;
  const releaseFile = path.join(stateDir, "release");
  try {
    const scheduler = new SessionScheduler({ stateDir, sessionId: "shared", clock: () => 1_000 });
    await scheduler.init();
    const task = await scheduler.createLoopTask({ prompt: "fixture", intervalMs: 1_000, mode: "fixed" });
    const worker = `
      const fs = await import("node:fs/promises");
      const { SessionScheduler } = await import(process.argv[1]);
      const stateDir = process.argv[2];
      const scheduler = new SessionScheduler({ stateDir, sessionId: "shared", clock: () => 2001,
        onDue: async () => {
          await fs.writeFile(stateDir + "/entered", "1");
          while (true) {
            try { await fs.access(stateDir + "/release"); break; }
            catch { await new Promise((resolve) => setTimeout(resolve, 5)); }
          }
        }
      });
      await scheduler.init();
      await scheduler.runDueTasksOnce();
    `;
    running = run(process.execPath, ["--input-type=module", "-e", worker, moduleUrl, stateDir],
      { timeout: 15_000 }).catch((error) => { childError = error; });
    const deadline = Date.now() + 10_000;
    while (true) {
      if (childError) throw childError;
      try { await fs.access(path.join(stateDir, "entered")); break; }
      catch {
        assert.ok(Date.now() < deadline, "worker must reach callback before deadline");
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
    await scheduler.cancelTask(task.id);
    await fs.writeFile(releaseFile, "1");
    await running;
    if (childError) throw childError;
    assert.equal((await scheduler.listTasks())[0].status, "canceled");
  } finally {
    await fs.writeFile(releaseFile, "1");
    await running;
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

for (const holdSuccessor of [false, true]) test(`a stale owner cannot overwrite a ${holdSuccessor ? "running" : "completed"} successor`, async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-scheduler-successor-"));
  let now = 1_000;
  let entered, release;
  const started = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  let nextEntered, releaseNext;
  const nextStarted = new Promise((resolve) => { nextEntered = resolve; });
  const nextGate = new Promise((resolve) => { releaseNext = resolve; });
  let successorRun;
  const first = new SessionScheduler({ stateDir, sessionId: "shared", claimLeaseMs: 10, clock: () => now,
    onDue: async () => { entered(); await gate; } });
  await first.init();
  const task = await first.createLoopTask({ prompt: "fixture", intervalMs: 1_000, mode: "fixed" });
  now = 2_001;
  const running = first.runDueTasksOnce();
  try {
    await started;
    now = 3_001;
    const second = new SessionScheduler({ stateDir, sessionId: "shared", claimLeaseMs: 10, clock: () => now,
      onDue: async () => { nextEntered(); if (holdSuccessor) await nextGate; } });
    await second.init();
    await second.runDueTasksOnce();
    assert.equal((await second.listTasks())[0].status, "blocked");
    await second.reconcileTask(task.id);
    successorRun = second.runDueTasksOnce();
    await nextStarted;
    if (!holdSuccessor) await successorRun;
    const successor = (await second.listTasks())[0];
    release();
    await running;
    assert.deepEqual((await second.listTasks())[0], successor);
  } finally {
    release();
    releaseNext();
    await running;
    await successorRun;
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test("session scheduler creates, lists, and cancels loop tasks", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-scheduler-"));
  const calls = [];
  const scheduler = new SessionScheduler({
    stateDir,
    sessionId: "session-a",
    runner: "session",
    onDue: async (task) => {
      calls.push(task.id);
    },
    clock: () => 1_000,
  });
  await scheduler.init();

  const task = await scheduler.createLoopTask({
    prompt: "检查构建",
    intervalMs: 60_000,
    mode: "fixed",
    runner: "session",
  });
  assert.ok(task.id);
  assert.equal(task.runner, "session");

  const listed = await scheduler.listTasks();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].prompt, "检查构建");

  const canceled = await scheduler.cancelTask(task.id);
  assert.equal(canceled.status, "canceled");
  assert.equal(calls.length, 0);
});

test("session scheduler marks due tasks as pending when busy, then runs once after idle", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-scheduler-busy-"));
  const fired = [];
  let now = 0;
  const scheduler = new SessionScheduler({
    stateDir,
    sessionId: "session-b",
    runner: "session",
    onDue: async (task) => {
      fired.push(task.id);
    },
    clock: () => now,
  });
  await scheduler.init();
  const task = await scheduler.createLoopTask({
    prompt: "轮询部署",
    intervalMs: 60_000,
    mode: "fixed",
    runner: "session",
  });

  scheduler.setBusy(true);
  now = 60_001;
  const busyRun = await scheduler.runDueTasksOnce();
  assert.equal(busyRun.triggered, 0);
  const pendingTask = (await scheduler.listTasks()).find((item) => item.id === task.id);
  assert.equal(pendingTask.pending, true);

  scheduler.setBusy(false);
  const idleRun = await scheduler.runDueTasksOnce();
  assert.equal(idleRun.triggered, 1);
  assert.deepEqual(fired, [task.id]);

  const after = (await scheduler.listTasks()).find((item) => item.id === task.id);
  assert.equal(after.pending, false);
  assert.ok(after.nextRunAt > now);
});

test("session scheduler filters execution by runner", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-scheduler-runner-"));
  const sessionCalls = [];
  const daemonCalls = [];
  let now = 0;

  const sessionScheduler = new SessionScheduler({
    stateDir,
    sessionId: "session-runner",
    runner: "session",
    onDue: async (task) => {
      sessionCalls.push(task.id);
    },
    clock: () => now,
  });
  await sessionScheduler.init();

  const daemonScheduler = new SessionScheduler({
    stateDir,
    sessionId: "session-runner",
    runner: "daemon",
    onDue: async (task) => {
      daemonCalls.push(task.id);
    },
    clock: () => now,
  });
  await daemonScheduler.init();

  const localTask = await sessionScheduler.createLoopTask({
    prompt: "本地轮询",
    intervalMs: 60_000,
    mode: "fixed",
    runner: "session",
  });
  const durableTask = await sessionScheduler.createLoopTask({
    prompt: "后台轮询",
    intervalMs: 60_000,
    mode: "fixed",
    runner: "daemon",
  });

  now = 60_001;
  let result = await sessionScheduler.runDueTasksOnce();
  assert.equal(result.triggered, 1);
  assert.deepEqual(sessionCalls, [localTask.id]);
  assert.deepEqual(daemonCalls, []);

  result = await daemonScheduler.runDueTasksOnce();
  assert.equal(result.triggered, 1);
  assert.deepEqual(daemonCalls, [durableTask.id]);
});

test("session scheduler backs off failures and stops after four attempts", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-scheduler-failure-"));
  let now = 0;
  const scheduler = new SessionScheduler({
    stateDir,
    sessionId: "session-failure",
    runner: "daemon",
    clock: () => now,
    onDue: async () => { throw new Error("build failed"); },
  });
  await scheduler.init();
  const task = await scheduler.createLoopTask({
    prompt: "失败任务",
    intervalMs: 1_000,
    mode: "fixed",
    runner: "daemon",
  });

  for (let attempt = 1; attempt <= 4; attempt++) {
    now = attempt === 1 ? 1_001 : (await scheduler.listTasks())[0].backoffUntil;
    const result = await scheduler.runDueTasksOnce();
    assert.equal(result.triggered, 0);
  }

  const failed = (await scheduler.listTasks()).find((item) => item.id === task.id);
  assert.equal(failed.status, "failed");
  assert.equal(failed.attemptCount, 4);
  assert.equal(failed.consecutiveFailures, 4);
  assert.match(failed.lastError.message, /build failed/);
});
