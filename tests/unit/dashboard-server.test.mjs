import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

import { DashboardServer } from "../../dist/dashboard-server.js";
import { MetricsCollector } from "../../dist/metrics/collector.js";
import { MissionManager } from "../../dist/mission/manager.js";
import { WorkflowRuntime } from "../../dist/workflow-runtime.js";

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

test("dashboard server serves a single secure task snapshot with ETag and local controls", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "qling-dashboard-"));
  const port = await freePort();
  const daemonPort = await freePort();
  const previousDaemonPort = process.env.QLING_DAEMON_PORT;
  process.env.QLING_DAEMON_PORT = String(daemonPort);
  const manager = new MissionManager(stateDir);
  await manager.init();
  const mission = await manager.createMission("分析仓库", "读取源码并输出报告", "session-dashboard");
  await manager.appendLog(mission.id, "开始读取目录");

  const tasksDir = join(stateDir, "session-tasks");
  await mkdir(tasksDir, { recursive: true });
  await writeFile(join(tasksDir, "session-dashboard.json"), JSON.stringify([{
    id: "tsk_loop_dash",
    kind: "loop",
    prompt: "检查构建",
    intervalMs: 60000,
    mode: "fixed",
    runner: "session",
    status: "active",
    pending: false,
    createdAt: 10,
    updatedAt: 20,
    nextRunAt: 70000,
  }]));

  const collector = new MetricsCollector(join(stateDir, "metrics"), "session-dashboard");
  await collector.init();
  collector.record({ type: "tool_call", data: { toolName: "read" } });

  const workflow = new WorkflowRuntime(join(stateDir, "workflows"));
  await workflow.init();
  const agent = Object.assign(new EventEmitter(), {
    turnCount: 2,
    getMissionManager: () => manager,
    getRuntimeRootDir: () => stateDir,
    getSessionId: () => "session-dashboard",
    getPermissionMode: () => "allow",
  });
  const dashboard = new DashboardServer({
    port,
    collector,
    workflowRuntime: workflow,
    agentLoop: agent,
  });

  try {
    await dashboard.start();
    const base = `http://127.0.0.1:${port}`;
    const response = await fetch(`${base}/api/dashboard/snapshot`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.match(response.headers.get("content-security-policy") || "", /default-src 'self'/);
    const etag = response.headers.get("etag");
    assert.ok(etag);

    const snapshot = await response.json();
    assert.equal(snapshot.tasks.length, 2);
    assert.deepEqual(snapshot.tasks.map((task) => task.kind), ["mission", "loop"]);
    assert.equal(snapshot.tasks[0].title, "分析仓库");
    assert.equal(snapshot.activity[0].data.toolName, "read");
    assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) < 200 * 1024);

    const notModified = await fetch(`${base}/api/dashboard/snapshot`, {
      headers: { "If-None-Match": etag },
    });
    assert.equal(notModified.status, 304);

    const detail = await fetch(`${base}/api/tasks/mission/${mission.id}`);
    assert.equal(detail.status, 200);
    const detailBody = await detail.json();
    assert.equal(detailBody.task.id, mission.id);
    assert.equal(detailBody.events.length > 0, true);

    const paused = await fetch(`${base}/api/tasks/mission/${mission.id}/pause`, { method: "POST" });
    assert.equal(paused.status, 200);
    const pausedBody = await paused.json();
    assert.equal(pausedBody.source, "local");
    assert.equal(pausedBody.task.status, "paused");

    const retry = await fetch(`${base}/api/tasks/mission/${mission.id}/retry`, { method: "POST" });
    assert.equal(retry.status, 503);

    const missing = await fetch(`${base}/api/not-real`);
    assert.equal(missing.status, 404);
    assert.match(missing.headers.get("content-type") || "", /application\/json/);

    const client = await fetch(`${base}/assets/dashboard.js`);
    assert.equal(client.status, 200);
    assert.match(client.headers.get("content-type") || "", /javascript/);
    assert.doesNotMatch(await client.text(), /sess:\s*any/);
  } finally {
    dashboard.stop();
    if (previousDaemonPort === undefined) delete process.env.QLING_DAEMON_PORT;
    else process.env.QLING_DAEMON_PORT = previousDaemonPort;
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("dashboard snapshot bounds 1000 tasks and observes missions created by another process", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "qling-dashboard-scale-"));
  const port = await freePort();
  const daemonPort = await freePort();
  const previousDaemonPort = process.env.QLING_DAEMON_PORT;
  process.env.QLING_DAEMON_PORT = String(daemonPort);
  const manager = new MissionManager(stateDir);
  await manager.init();
  const tasksDir = join(stateDir, "session-tasks");
  await mkdir(tasksDir, { recursive: true });
  await writeFile(join(tasksDir, "session-scale.json"), JSON.stringify(
    Array.from({ length: 1000 }, (_, index) => ({
      id: `tsk_scale_${index}`,
      kind: "loop",
      prompt: `检查任务 ${index} 的构建与测试状态`,
      intervalMs: 60000,
      mode: "fixed",
      runner: "session",
      status: index < 10 ? "running" : "active",
      pending: false,
      createdAt: index,
      updatedAt: index,
      nextRunAt: 70000 + index,
    }))
  ));

  const collector = new MetricsCollector(join(stateDir, "metrics"), "session-scale");
  await collector.init();
  const workflow = new WorkflowRuntime(join(stateDir, "workflows"));
  await workflow.init();
  const agent = Object.assign(new EventEmitter(), {
    turnCount: 0,
    getMissionManager: () => manager,
    getRuntimeRootDir: () => stateDir,
    getSessionId: () => "session-scale",
    getPermissionMode: () => "allow",
  });
  const dashboard = new DashboardServer({ port, collector, workflowRuntime: workflow, agentLoop: agent });

  try {
    await dashboard.start();
    const base = `http://127.0.0.1:${port}`;
    const startedAt = performance.now();
    const response = await fetch(`${base}/api/dashboard/snapshot`);
    const elapsedMs = performance.now() - startedAt;
    const payload = await response.text();
    const snapshot = JSON.parse(payload);

    assert.equal(response.status, 200);
    assert.equal(snapshot.summary.total, 1000);
    assert.equal(snapshot.tasks.length, 50);
    assert.ok(elapsedMs < 500, `snapshot took ${elapsedMs.toFixed(1)}ms`);
    assert.ok(Buffer.byteLength(payload) < 200 * 1024);

    const externalManager = new MissionManager(stateDir);
    await externalManager.init();
    await externalManager.createMission("外部守护进程任务", "应在下一次磁盘刷新后可见", "session-external");
    await new Promise((resolve) => setTimeout(resolve, 800));

    const refreshed = await fetch(`${base}/api/dashboard/snapshot`).then((value) => value.json());
    assert.equal(refreshed.summary.total, 1001);
    const missions = await fetch(`${base}/api/missions`).then((value) => value.json());
    assert.equal(missions.some((mission) => mission.name === "外部守护进程任务"), true);
  } finally {
    dashboard.stop();
    if (previousDaemonPort === undefined) delete process.env.QLING_DAEMON_PORT;
    else process.env.QLING_DAEMON_PORT = previousDaemonPort;
    await rm(stateDir, { recursive: true, force: true });
  }
});
