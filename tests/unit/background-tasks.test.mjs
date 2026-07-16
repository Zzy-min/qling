import test from "node:test";
import assert from "node:assert/strict";
import {
  getBackgroundTaskRegistry,
  resetBackgroundTaskRegistryForTests,
  formatBgTaskLine,
  formatBgTaskNotify,
} from "../../dist/runtime/background-tasks.js";
import { runBash } from "../../dist/tools/bash.js";
import { runBgList, runBgWait, runBgKill } from "../../dist/tools/bg-task.js";

test.afterEach(() => {
  resetBackgroundTaskRegistryForTests();
});

test("startShell returns task_id and completes", async () => {
  const reg = getBackgroundTaskRegistry();
  const events = [];
  reg.on("event", (e) => events.push(e.type));

  const cmd =
    process.platform === "win32"
      ? "ping -n 1 127.0.0.1 >nul"
      : "sleep 0.2; echo hi-bg";
  const task = reg.startShell({
    command: cmd,
    cwd: process.cwd(),
    timeoutSec: 30,
  });
  assert.match(task.taskId, /^bg_/);
  assert.equal(task.status, "running");
  assert.ok(events.includes("started"));

  const done = await reg.wait(task.taskId, 15_000);
  assert.ok(["completed", "failed"].includes(done.status));
  assert.ok(events.includes("finished"));
  assert.match(formatBgTaskLine(done), /bg_/);
});

test("bash background:true returns task_id without waiting for process", async () => {
  const prevWs = process.env.QLING_WORKSPACE_DIR;
  process.env.QLING_WORKSPACE_DIR = process.cwd();
  try {
    const cmd =
      process.platform === "win32"
        ? "ping -n 2 127.0.0.1 >nul"
        : "sleep 1; echo done";
    const t0 = Date.now();
    const result = await runBash({
      command: cmd,
      background: true,
      timeout: 30,
      cwd: process.cwd(),
    });
    const elapsed = Date.now() - t0;
    assert.notEqual(result.is_error, true, result.output);
    assert.match(result.output, /task_id:\s*bg_/);
    // 应快速返回，不阻塞完整 sleep
    assert.ok(elapsed < 800, `expected fast return, got ${elapsed}ms`);

    const m = result.output.match(/task_id:\s*(bg_\S+)/);
    assert.ok(m);
    const list = await runBgList({});
    assert.match(list.output, new RegExp(m[1]));
    await runBgKill({ task_id: m[1] });
  } finally {
    if (prevWs === undefined) delete process.env.QLING_WORKSPACE_DIR;
    else process.env.QLING_WORKSPACE_DIR = prevWs;
  }
});

test("bg_wait and kill", async () => {
  const reg = getBackgroundTaskRegistry();
  const cmd =
    process.platform === "win32"
      ? "ping -n 5 127.0.0.1 >nul"
      : "sleep 5";
  const task = reg.startShell({
    command: cmd,
    cwd: process.cwd(),
    timeoutSec: 60,
  });
  const killed = await runBgKill({ task_id: task.taskId });
  assert.match(killed.output, /status:\s*(killed|timeout|failed|completed)/i);

  // already finished: wait returns snapshot
  const waited = await runBgWait({ task_id: task.taskId, timeout_ms: 2000 });
  assert.ok(waited.output.includes(task.taskId));
});

test("formatBgTaskNotify", () => {
  const task = {
    taskId: "bg_x",
    kind: "shell",
    status: "running",
    command: "echo hi",
    cwd: ".",
    createdAt: 1,
    updatedAt: 1,
    output: "",
    maxLifetimeMs: 1000,
  };
  assert.match(formatBgTaskNotify({ type: "started", task }), /后台启动/);
  assert.match(
    formatBgTaskNotify({
      type: "finished",
      task: { ...task, status: "completed" },
    }),
    /后台完成/
  );
});
