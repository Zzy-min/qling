import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  cancelLocalSessionTask,
  formatSessionTaskReport,
  listLocalSessionTasks,
  parseSessionTaskCount,
} from "../../dist/session-task-report.js";

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-task-report-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function writeTasks(root, sessionId, tasks) {
  const dir = path.join(root, "session-tasks");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${sessionId}.json`), JSON.stringify(tasks, null, 2), "utf8");
}

function task(id, overrides = {}) {
  return {
    id,
    kind: "loop",
    prompt: "SECRET_TASK_PROMPT_BODY should only appear as a bounded task summary",
    intervalMs: 60_000,
    mode: "fixed",
    runner: "daemon",
    status: "active",
    pending: false,
    createdAt: 1_000,
    updatedAt: 1_000,
    nextRunAt: 61_000,
    ...overrides,
  };
}

test("session task report returns empty report when directory is missing", async () => {
  await withTempDir(async (root) => {
    const report = await listLocalSessionTasks(root);

    assert.equal(report.totalTasks, 0);
    assert.equal(report.tasks.length, 0);
    assert.equal(report.tasksDir, path.join(root, "session-tasks"));
    assert.match(formatSessionTaskReport(report).join("\n"), /\/loop/);
  });
});

test("session task report sorts by updated time, applies count, and does not read session bodies", async () => {
  await withTempDir(async (root) => {
    await writeTasks(root, "session-old", [
      task("tsk_old", {
        prompt: "old prompt",
        updatedAt: 2_000,
        createdAt: 1_000,
      }),
    ]);
    await writeTasks(root, "session-new", [
      task("tsk_new", {
        prompt: "new prompt",
        updatedAt: 4_000,
        createdAt: 3_000,
      }),
    ]);
    await fs.mkdir(path.join(root, "sessions"), { recursive: true });
    await fs.writeFile(path.join(root, "sessions", "session-new.json"), "SECRET_SESSION_BODY", "utf8");

    const report = await listLocalSessionTasks(root, { count: 1 });
    const output = formatSessionTaskReport(report).join("\n");

    assert.equal(report.totalTasks, 2);
    assert.deepEqual(report.tasks.map((item) => item.id), ["tsk_new"]);
    assert.match(output, /tsk_new/);
    assert.doesNotMatch(output, /tsk_old/);
    assert.doesNotMatch(output, /SECRET_SESSION_BODY/);
  });
});

test("session task count defaults to 20 and clamps at 100", () => {
  assert.equal(parseSessionTaskCount(undefined), 20);
  assert.equal(parseSessionTaskCount("bad"), 20);
  assert.equal(parseSessionTaskCount("0"), 20);
  assert.equal(parseSessionTaskCount("101"), 100);
  assert.equal(parseSessionTaskCount("7"), 7);
});

test("session task report supports an explicit internal maximum without changing the public default", async () => {
  await withTempDir(async (root) => {
    await writeTasks(root, "session-large", Array.from({ length: 150 }, (_, index) =>
      task(`tsk_${index}`, { updatedAt: index })
    ));

    const publicReport = await listLocalSessionTasks(root, { count: 150 });
    const internalReport = await listLocalSessionTasks(root, { count: 150, maxCount: 500 });

    assert.equal(publicReport.tasks.length, 100);
    assert.equal(internalReport.tasks.length, 150);
    assert.equal(internalReport.totalTasks, 150);
  });
});

test("session task cancel persists canceled status and clears pending", async () => {
  await withTempDir(async (root) => {
    await writeTasks(root, "session-cancel", [
      task("tsk_keep", { updatedAt: 1_000 }),
      task("tsk_cancel", { pending: true, status: "running", updatedAt: 2_000 }),
    ]);

    const canceled = await cancelLocalSessionTask(root, "tsk_cancel", { clock: () => 9_000 });
    const raw = await fs.readFile(path.join(root, "session-tasks", "session-cancel.json"), "utf8");
    const persisted = JSON.parse(raw);
    const saved = persisted.find((item) => item.id === "tsk_cancel");

    assert.equal(canceled.id, "tsk_cancel");
    assert.equal(canceled.sessionId, "session-cancel");
    assert.equal(saved.status, "canceled");
    assert.equal(saved.pending, false);
    assert.equal(saved.updatedAt, 9_000);
  });
});

test("session task cancel reports missing task clearly", async () => {
  await withTempDir(async (root) => {
    await writeTasks(root, "session-a", [task("tsk_existing")]);

    await assert.rejects(
      () => cancelLocalSessionTask(root, "tsk_missing"),
      /session task not found: tsk_missing/
    );
  });
});
