import test from "node:test";
import assert from "node:assert/strict";
import { BackgroundTaskRegistry } from "../../dist/runtime/background-tasks.js";

test("background registry tracks promise-backed subagent tasks", async () => {
  const registry = new BackgroundTaskRegistry();
  const task = registry.startPromise({
    label: "subagent:test",
    cwd: process.cwd(),
    promise: Promise.resolve("done"),
  });
  assert.equal(task.kind, "subagent");
  const finished = await registry.wait(task.taskId, 1000);
  assert.equal(finished.status, "completed");
  assert.equal(finished.output, "done");
  registry.resetForTests();
});
