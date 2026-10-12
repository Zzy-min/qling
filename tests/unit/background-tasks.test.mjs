import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  BackgroundTaskRegistry,
  getBackgroundTaskRegistry,
  resetBackgroundTaskRegistryForTests,
  formatBgTaskLine,
  formatBgTaskNotify,
  truncateBytes,
} from "../../dist/runtime/background-tasks.js";
import { runBash } from "../../dist/tools/bash.js";
import { runBgList, runBgWait, runBgKill, runBgReconcile } from "../../dist/tools/bg-task.js";
import { SpeculativeClassifier } from "../../dist/pipeline/hooks.js";
import { SessionLease } from "../../dist/runtime/session-lease.js";

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
  const settledStatus = reg.get(task.taskId)?.status;

  // already finished: wait returns snapshot
  const waited = await runBgWait({ task_id: task.taskId, timeout_ms: 2000 });
  assert.ok(waited.output.includes(task.taskId));
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(reg.get(task.taskId)?.status, settledStatus, "a delayed close event must not overwrite the kill settlement");
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

test("persistent registry restores interrupted tasks as unknown outcome without command or output", async () => {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-bg-persist-"));
  const taskId = "bg_interrupted";
  await fs.writeFile(path.join(stateDir, "background-tasks.json"), JSON.stringify({
    version: 1,
    tasks: [{
      taskId,
      kind: "shell",
      status: "running",
      command: "<redacted>",
      commandHash: "1234567890abcdef1234567890abcdef",
      cwd: process.cwd(),
      pid: 1234,
      createdAt: 100,
      updatedAt: 100,
      processStartedAt: 100,
      output: "",
      maxLifetimeMs: 60_000,
    }],
  }));
  try {
    const restored = new BackgroundTaskRegistry({ stateDir, persist: true }).get(taskId);
    assert.equal(restored.status, "unknown_outcome");
    assert.doesNotMatch(restored.command, /secret command/);
    assert.equal(restored.output, "");
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test("bg_wait keeps an unknown background outcome pending", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-bg-unknown-wait-"));
  const previousReliability = process.env.QLING_FEATURES_RELIABILITY_V2;
  const previousStateDir = process.env.QLING_FILE_STATE_DIR;
  const taskId = "bg_unknown_wait";
  try {
    await fs.writeFile(path.join(stateDir, "background-tasks.json"), JSON.stringify({
      version: 1,
      tasks: [{
        taskId,
        kind: "shell",
        status: "running",
        command: "<redacted>",
        commandHash: "1234567890abcdef1234567890abcdef",
        cwd: process.cwd(),
        createdAt: 100,
        updatedAt: 100,
        output: "",
        maxLifetimeMs: 60_000,
      }],
    }));
    resetBackgroundTaskRegistryForTests();
    process.env.QLING_FEATURES_RELIABILITY_V2 = "true";
    process.env.QLING_FILE_STATE_DIR = stateDir;

    const waited = await runBgWait({ task_id: taskId, timeout_ms: 0 });
    assert.equal(waited.is_error, true);
    assert.match(waited.output, /unknown_outcome/i);
    assert.equal(waited.meta?.backgroundTaskCompleted, undefined);
  } finally {
    resetBackgroundTaskRegistryForTests();
    if (previousReliability === undefined) delete process.env.QLING_FEATURES_RELIABILITY_V2;
    else process.env.QLING_FEATURES_RELIABILITY_V2 = previousReliability;
    if (previousStateDir === undefined) delete process.env.QLING_FILE_STATE_DIR;
    else process.env.QLING_FILE_STATE_DIR = previousStateDir;
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test("unknown background outcome requires explicit reconciliation and becomes durable terminal state", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-bg-reconcile-"));
  const previousReliability = process.env.QLING_FEATURES_RELIABILITY_V2;
  const previousStateDir = process.env.QLING_FILE_STATE_DIR;
  const previousWorkspaceDir = process.env.QLING_WORKSPACE_DIR;
  const taskId = "bg_unknown_reconcile";
  try {
    await fs.writeFile(path.join(stateDir, "background-tasks.json"), JSON.stringify({
      version: 1,
      tasks: [{ taskId, kind: "shell", status: "running", command: "<redacted>", commandHash: "abcdef", cwd: stateDir, createdAt: 1, updatedAt: 1, output: "", maxLifetimeMs: 1000 }],
    }));
    resetBackgroundTaskRegistryForTests();
    process.env.QLING_FEATURES_RELIABILITY_V2 = "true";
    process.env.QLING_FILE_STATE_DIR = stateDir;
    process.env.QLING_WORKSPACE_DIR = stateDir;

    const denied = await runBgReconcile({ task_id: taskId, confirm_unknown_outcome: false });
    assert.equal(denied.is_error, true);
    assert.equal(getBackgroundTaskRegistry().get(taskId)?.status, "unknown_outcome");

    const accepted = await runBgReconcile({ task_id: taskId, confirm_unknown_outcome: true });
    assert.equal(accepted.is_error, undefined);
    assert.equal(accepted.meta?.backgroundTaskReconciliationPending, taskId);
    assert.equal(getBackgroundTaskRegistry().get(taskId)?.status, "reconciliation_pending");
    const interrupted = new BackgroundTaskRegistry({ stateDir, persist: true });
    assert.equal(interrupted.get(taskId)?.status, "reconciliation_pending");

    const replayed = await runBgReconcile({ task_id: taskId, confirm_unknown_outcome: true });
    assert.equal(replayed.is_error, undefined, "reconciliation is idempotent across the checkpoint crash window");
    getBackgroundTaskRegistry().completeUnknownOutcomeReconciliation(taskId, { workspaceDir: stateDir });
    assert.equal(getBackgroundTaskRegistry().get(taskId)?.status, "acknowledged");
    const restored = new BackgroundTaskRegistry({ stateDir, persist: true }).get(taskId);
    assert.equal(restored?.status, "acknowledged");
  } finally {
    resetBackgroundTaskRegistryForTests();
    if (previousReliability === undefined) delete process.env.QLING_FEATURES_RELIABILITY_V2;
    else process.env.QLING_FEATURES_RELIABILITY_V2 = previousReliability;
    if (previousStateDir === undefined) delete process.env.QLING_FILE_STATE_DIR;
    else process.env.QLING_FILE_STATE_DIR = previousStateDir;
    if (previousWorkspaceDir === undefined) delete process.env.QLING_WORKSPACE_DIR;
    else process.env.QLING_WORKSPACE_DIR = previousWorkspaceDir;
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test("background task ownership prevents cross-workspace recovery and reconciliation", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-bg-owner-state-"));
  const workspaceA = await fs.mkdtemp(path.join(os.tmpdir(), "qling-bg-owner-a-"));
  const workspaceB = await fs.mkdtemp(path.join(os.tmpdir(), "qling-bg-owner-b-"));
  try {
    await fs.writeFile(path.join(stateDir, "background-tasks.json"), JSON.stringify({
      version: 1,
      tasks: [{ taskId: "bg_owned", kind: "shell", status: "unknown_outcome", command: "<redacted>", commandHash: "abcdef", cwd: workspaceA, ownerWorkspace: workspaceA, ownerSessionId: "session-a", ownerRunId: "run-a", createdAt: 1, updatedAt: 1, output: "", maxLifetimeMs: 1000 }],
    }));
    const registry = new BackgroundTaskRegistry({ stateDir, persist: true });
    assert.throws(
      () => registry.beginUnknownOutcomeReconciliation("bg_owned", { workspaceDir: workspaceB, sessionId: "session-a", runId: "run-a" }),
      /different workspace or run/,
    );
    assert.throws(
      () => registry.beginUnknownOutcomeReconciliation("bg_owned", { workspaceDir: workspaceA, sessionId: "session-b", runId: "run-a" }),
      /different workspace or run/,
    );
    assert.equal(registry.beginUnknownOutcomeReconciliation("bg_owned", { workspaceDir: workspaceA, sessionId: "session-a", runId: "run-a" }).status, "reconciliation_pending");
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
    await fs.rm(workspaceA, { recursive: true, force: true });
    await fs.rm(workspaceB, { recursive: true, force: true });
  }
});

test("owned task listing filters before applying its limit and can span prior runs in one session", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-bg-owner-list-"));
  const workspaceA = await fs.mkdtemp(path.join(os.tmpdir(), "qling-bg-owner-list-a-"));
  const workspaceB = await fs.mkdtemp(path.join(os.tmpdir(), "qling-bg-owner-list-b-"));
  try {
    const registry = new BackgroundTaskRegistry({ stateDir, persist: false });
    const owned = registry.startPromise({
      label: "owned-old-run",
      cwd: workspaceA,
      promise: Promise.resolve("done"),
      owner: { workspaceDir: workspaceA, sessionId: "session-a", runId: "run-a" },
    });
    await registry.wait(owned.taskId, 2_000);
    for (let index = 0; index < 3; index++) {
      const foreign = registry.startPromise({
        label: `foreign-${index}`,
        cwd: workspaceB,
        promise: Promise.resolve("done"),
        owner: { workspaceDir: workspaceB, sessionId: "session-b", runId: `run-b-${index}` },
      });
      await registry.wait(foreign.taskId, 2_000);
    }

    assert.deepEqual(
      registry.listOwned(
        { workspaceDir: workspaceA, sessionId: "session-a" },
        { includeFinished: true, limit: 1 },
      ).map((task) => task.taskId),
      [owned.taskId],
      "foreign recent tasks must not consume the current owner's limit",
    );
    assert.equal(
      registry.listOwned(
        { workspaceDir: workspaceA, sessionId: "session-a", runId: "run-b" },
        { includeFinished: true },
      ).length,
      0,
      "an exact run filter must not adopt a prior run",
    );
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
    await fs.rm(workspaceA, { recursive: true, force: true });
    await fs.rm(workspaceB, { recursive: true, force: true });
  }
});

test("terminating one run leaves a durable session-visible accounting barrier", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-bg-run-cancel-"));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "qling-bg-run-cancel-ws-"));
  try {
    const registry = new BackgroundTaskRegistry({ stateDir, persist: true });
    const command = process.platform === "win32" ? "ping -n 30 127.0.0.1 >nul" : "sleep 30";
    const canceled = registry.startShell({
      command,
      cwd: workspace,
      timeoutSec: 60,
      owner: { workspaceDir: workspace, sessionId: "session-a", runId: "run-a" },
    });
    const other = registry.startShell({
      command,
      cwd: workspace,
      timeoutSec: 60,
      owner: { workspaceDir: workspace, sessionId: "session-a", runId: "run-b" },
    });

    const terminated = await registry.terminateOwned(
      { workspaceDir: workspace, sessionId: "session-a", runId: "run-a" },
      "user",
    );
    assert.deepEqual(terminated.map((task) => task.taskId), [canceled.taskId]);
    assert.notEqual(registry.get(canceled.taskId)?.status, "running");
    assert.equal(registry.get(canceled.taskId)?.accountingStatus, "pending");
    assert.equal(registry.get(other.taskId)?.status, "running", "cancel must stay scoped to the active run");

    const nextRunBarrier = registry.listOwned(
      { workspaceDir: workspace, sessionId: "session-a" },
      { includeFinished: true },
    ).find((task) => task.taskId === canceled.taskId);
    assert.ok(nextRunBarrier, "the next run in the same session must inherit the unsettled task");
    assert.equal(nextRunBarrier.accountingStatus, "pending");
    await registry.kill(other.taskId, "user");
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("background registries are isolated by state directory", async () => {
  const stateA = await fs.mkdtemp(path.join(os.tmpdir(), "qling-bg-state-a-"));
  const stateB = await fs.mkdtemp(path.join(os.tmpdir(), "qling-bg-state-b-"));
  const previousReliability = process.env.QLING_FEATURES_RELIABILITY_V2;
  try {
    process.env.QLING_FEATURES_RELIABILITY_V2 = "true";
    const registryA = getBackgroundTaskRegistry(stateA);
    const registryB = getBackgroundTaskRegistry(stateB);
    assert.notEqual(registryA, registryB);
    const task = registryA.startPromise({ label: "state-a", cwd: stateA, promise: Promise.resolve("done") });
    await registryA.wait(task.taskId, 2_000);
    assert.equal(registryB.get(task.taskId), null);
  } finally {
    resetBackgroundTaskRegistryForTests();
    if (previousReliability === undefined) delete process.env.QLING_FEATURES_RELIABILITY_V2;
    else process.env.QLING_FEATURES_RELIABILITY_V2 = previousReliability;
    await fs.rm(stateA, { recursive: true, force: true });
    await fs.rm(stateB, { recursive: true, force: true });
  }
});

test("concurrent registries in one state directory do not overwrite each other's tasks", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-bg-concurrent-state-"));
  try {
    const first = new BackgroundTaskRegistry({ stateDir, persist: true });
    const second = new BackgroundTaskRegistry({ stateDir, persist: true });
    const taskA = first.startPromise({ label: "first-process", cwd: stateDir, promise: Promise.resolve("a") });
    await first.wait(taskA.taskId, 2_000);
    const taskB = second.startPromise({ label: "second-process", cwd: stateDir, promise: Promise.resolve("b") });
    await second.wait(taskB.taskId, 2_000);

    const restored = new BackgroundTaskRegistry({ stateDir, persist: true });
    assert.ok(restored.get(taskA.taskId), "the first writer's pending record must survive the second writer");
    assert.ok(restored.get(taskB.taskId), "the second writer's pending record must be present");
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test("another registry cannot project a live leased task as unknown or reconcile it", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-bg-live-owner-"));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "qling-bg-live-workspace-"));
  const previousReliability = process.env.QLING_FEATURES_RELIABILITY_V2;
  let lease;
  try {
    process.env.QLING_FEATURES_RELIABILITY_V2 = "true";
    lease = SessionLease.acquire({ stateDir, sessionId: "session-live", workspaceDir: workspace });
    const owner = { workspaceDir: workspace, sessionId: "session-live", runId: "run-live", leaseToken: lease.token };
    const first = new BackgroundTaskRegistry({ stateDir, persist: true });
    const task = first.startShell({
      command: process.platform === "win32" ? "ping -n 5 127.0.0.1 >nul" : "sleep 5",
      cwd: workspace,
      owner,
    });
    const observer = new BackgroundTaskRegistry({ stateDir, persist: true });
    assert.equal(observer.get(task.taskId)?.status, "running");
    assert.throws(
      () => observer.beginUnknownOutcomeReconciliation(task.taskId, owner),
      /not unknown_outcome/,
    );
    await first.kill(task.taskId, "user");
  } finally {
    lease?.release();
    if (previousReliability === undefined) delete process.env.QLING_FEATURES_RELIABILITY_V2;
    else process.env.QLING_FEATURES_RELIABILITY_V2 = previousReliability;
    await fs.rm(stateDir, { recursive: true, force: true });
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("malformed immutable task record fails the completion barrier closed", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-bg-corrupt-record-"));
  try {
    const recordsDir = path.join(stateDir, "background-tasks");
    await fs.mkdir(recordsDir, { recursive: true });
    await fs.writeFile(path.join(recordsDir, "corrupt.json"), "{partial");
    const registry = new BackgroundTaskRegistry({ stateDir, persist: true });
    assert.throws(
      () => registry.listUnsettledOwned({ workspaceDir: stateDir, sessionId: "session-a" }),
      /BACKGROUND_RECORD_UNREADABLE/,
    );
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test("immutable persistence retains only the latest revision for a settled task", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-bg-revision-retention-"));
  try {
    const registry = new BackgroundTaskRegistry({ stateDir, persist: true });
    const task = registry.startPromise({ label: "revisioned", cwd: stateDir, promise: Promise.resolve("done") });
    await registry.wait(task.taskId, 2_000);
    registry.markAccountingSettled(task.taskId, { workspaceDir: stateDir });
    const entries = (await fs.readdir(path.join(stateDir, "background-tasks"))).filter((entry) => entry.endsWith(".json"));
    assert.equal(entries.length, 1, "obsolete running and pending revisions must be removed after settlement");
    const restored = new BackgroundTaskRegistry({ stateDir, persist: true }).get(task.taskId);
    assert.equal(restored?.status, "completed");
    assert.equal(restored?.accountingStatus, "settled");
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test("restore and completion gate enumerate every unsettled task without history limits", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-bg-unsettled-limit-"));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "qling-bg-unsettled-ws-"));
  try {
    const tasks = [];
    tasks.push({
      taskId: "bg_old_pending",
      kind: "shell",
      status: "killed",
      accountingStatus: "pending",
      command: "<redacted>",
      cwd: workspace,
      ownerWorkspace: workspace,
      ownerSessionId: "session-a",
      ownerRunId: "run-old",
      createdAt: 1,
      updatedAt: 1,
      output: "",
      maxLifetimeMs: 1000,
    });
    for (let index = 0; index < 120; index++) {
      tasks.push({
        taskId: `bg_settled_${index}`,
        kind: "shell",
        status: "completed",
        accountingStatus: "settled",
        command: "<redacted>",
        cwd: workspace,
        ownerWorkspace: workspace,
        ownerSessionId: "session-a",
        ownerRunId: `run-${index}`,
        createdAt: index + 2,
        updatedAt: index + 2,
        output: "",
        maxLifetimeMs: 1000,
      });
    }
    await fs.writeFile(path.join(stateDir, "background-tasks.json"), JSON.stringify({ version: 1, tasks }));
    const registry = new BackgroundTaskRegistry({ stateDir, persist: true });
    assert.deepEqual(
      registry.listUnsettledOwned({ workspaceDir: workspace, sessionId: "session-a" }).map((task) => task.taskId),
      ["bg_old_pending"],
      "settled history must never crowd an older pending side effect out of the completion gate",
    );
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("terminal background task stays unaccounted until an Agent checkpoint settles it", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-bg-accounting-"));
  try {
    const registry = new BackgroundTaskRegistry({ stateDir, persist: true });
    const task = registry.startPromise({ label: "quick", cwd: stateDir, promise: Promise.resolve("done"), owner: { workspaceDir: stateDir, sessionId: "s", runId: "r" } });
    const done = await registry.wait(task.taskId, 2_000);
    assert.equal(done.status, "completed");
    assert.equal(done.accountingStatus, "pending");
    const interrupted = new BackgroundTaskRegistry({ stateDir, persist: true }).get(task.taskId);
    assert.equal(interrupted?.accountingStatus, "pending", "a terminal process is not proof that the Agent recorded its side effects");
    registry.markAccountingSettled(task.taskId, { workspaceDir: stateDir, sessionId: "s", runId: "r" });
    const restored = new BackgroundTaskRegistry({ stateDir, persist: true }).get(task.taskId);
    assert.equal(restored?.accountingStatus, "settled");
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test("background reconciliation is always classified for explicit approval", () => {
  const classifier = new SpeculativeClassifier([{
    name: "bg_reconcile",
    description: "acknowledge unknown outcome",
    parameters: { type: "object" },
    readOnly: false,
    destructive: true,
    concurrencySafe: false,
  }]);
  assert.equal(classifier.classify({ id: "reconcile", name: "bg_reconcile", arguments: { task_id: "bg_x", confirm_unknown_outcome: true } }).label, "ask");
});

test("persistent registry retains the workspace baseline for unknown background outcomes", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-bg-baseline-"));
  try {
    const first = new BackgroundTaskRegistry({ stateDir, persist: true });
    const task = first.startShell({ command: process.platform === "win32" ? "ping -n 5 127.0.0.1 >nul" : "sleep 5", cwd: stateDir });
    first.setWorkspaceBaseline(task.taskId, { available: true, head: "abc", fingerprint: "abc:dirty", files: { "source.py": { hash: "before", created: false } } });
    const restored = new BackgroundTaskRegistry({ stateDir, persist: true }).get(task.taskId);
    assert.equal(restored?.status, "unknown_outcome");
    assert.equal(restored?.workspaceBaseline?.fingerprint, "abc:dirty");
    assert.deepEqual(restored?.workspaceBaseline?.files, { "source.py": { hash: "before", created: false } });
    await first.kill(task.taskId, "user");
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test("kill waits for a SIGTERM-resistant child tree before reporting completion", { skip: process.platform === "win32" }, async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-bg-kill-tree-"));
  const sentinel = path.join(stateDir, "late.txt");
  try {
    await fs.writeFile(path.join(stateDir, "child.mjs"), `import fs from "node:fs"; process.on("SIGTERM",()=>{}); setTimeout(()=>fs.writeFileSync(${JSON.stringify(sentinel)},"late"),900); setTimeout(()=>{},5000);\n`);
    await fs.writeFile(path.join(stateDir, "parent.mjs"), `import {spawn} from "node:child_process"; spawn(process.execPath,["child.mjs"],{stdio:"ignore"}); setTimeout(()=>{},5000);\n`);
    const reg = new BackgroundTaskRegistry({ persist: false });
    const task = reg.startShell({ command: "node parent.mjs", cwd: stateDir });
    const killed = await reg.kill(task.taskId, "user");
    assert.equal(killed.status, "killed");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await assert.rejects(fs.access(sentinel));
  } finally {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

test("background output keeps the head and tail inside the same byte cap", async () => {
  const maxBytes = 512 * 1024;
  const head = `BG_HEAD\n${"H".repeat(70 * 1024)}`;
  const tail = `${"T".repeat(64)}\nBG_TAIL`;
  const text = `${head}${"M".repeat(600 * 1024)}${tail}`;
  const clipped = truncateBytes(text, maxBytes);
  assert.equal(truncateBytes("short output", maxBytes), "short output");
  assert.ok(clipped.startsWith("BG_HEAD"));
  assert.ok(clipped.endsWith("BG_TAIL"));
  assert.match(clipped, /…\[省略 \d+ 字节\]…/);
  assert.ok(Buffer.byteLength(clipped) <= maxBytes);
  const emoji = `${"中".repeat(80_000)}🙂TAIL`;
  const emojiMax = 96 * 1024;
  const emojiClipped = truncateBytes(emoji, emojiMax);
  assert.ok(Buffer.byteLength(emojiClipped) <= emojiMax);
  assert.ok(emojiClipped.endsWith("🙂TAIL"));
  assert.ok(emojiClipped.startsWith("中"));
  assert.ok(Buffer.byteLength(truncateBytes(emoji, 48)) <= 48);

  const reg = new BackgroundTaskRegistry({ persist: false });
  const task = reg.startPromise({
    label: "bounded-output",
    cwd: process.cwd(),
    promise: Promise.resolve(text),
    timeoutMs: 10_000,
  });
  const done = await reg.wait(task.taskId, 5_000);
  assert.ok(done.output.includes("BG_HEAD"));
  assert.ok(done.output.includes("BG_TAIL"));
  assert.match(done.output, /…\[省略 \d+ 字节\]…/);
  assert.ok(Buffer.byteLength(done.output) <= maxBytes);

  const script = `process.stdout.write("BG_HEAD\\n"); process.stdout.write("M".repeat(${600 * 1024})); process.stdout.write("\\nBG_TAIL");`;
  const shell = new BackgroundTaskRegistry({ persist: false });
  const running = shell.startShell({
    command: "emit-bounded",
    cwd: process.cwd(),
    executable: process.execPath,
    executableArgs: ["-e", script],
    timeoutSec: 20,
  });
  const finished = await shell.wait(running.taskId, 15_000);
  assert.equal(finished.status, "completed", finished.output);
  assert.ok(finished.output.includes("BG_HEAD"));
  assert.ok(finished.output.includes("BG_TAIL"));
  assert.match(finished.output, /省略 \d+ 字节/);
  assert.ok(Buffer.byteLength(finished.output) <= maxBytes);
});
