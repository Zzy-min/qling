import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { SessionScheduler } from "../../dist/session/session-scheduler.js";

test("session scheduler creates, lists, and cancels loop tasks", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qingling-scheduler-"));
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
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qingling-scheduler-busy-"));
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
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qingling-scheduler-runner-"));
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
