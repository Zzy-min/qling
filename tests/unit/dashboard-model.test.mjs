import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDashboardTasks,
  getMissionActions,
} from "../../dist/dashboard/model.js";

test("dashboard model unifies missions loops and workflow with active tasks first", () => {
  const tasks = buildDashboardTasks({
    missions: [
      {
        id: "msn_done",
        name: "已完成分析",
        description: "完成的任务",
        status: "succeeded",
        sessionId: "s1",
        lastContext: [],
        metrics: { startTime: 10, endTime: 30, totalTurns: 3, totalTokens: 500, totalToolCalls: 2 },
        createdAt: 10,
        updatedAt: 30,
      },
      {
        id: "msn_run",
        name: "分析仓库",
        description: "读取代码并生成结构报告",
        status: "running",
        sessionId: "s2",
        lastContext: [],
        metrics: { startTime: 40, totalTurns: 4, totalTokens: 800, totalToolCalls: 6 },
        createdAt: 40,
        updatedAt: 60,
      },
    ],
    loops: [
      {
        id: "tsk_loop_1",
        kind: "loop",
        prompt: "每五分钟检查构建",
        intervalMs: 300000,
        mode: "fixed",
        runner: "session",
        status: "active",
        pending: false,
        createdAt: 20,
        updatedAt: 50,
        nextRunAt: 100,
        sessionId: "s3",
        filePath: "ignored",
      },
    ],
    workflow: {
      runId: "run_1",
      workflowId: "wf_1",
      sessionId: "s4",
      status: "paused",
      currentState: "review",
      history: [],
      contextSnapshot: [],
      pendingToolCalls: [],
      completedToolResults: [],
      updatedAt: 55,
    },
    daemonHealthy: true,
    now: 1000,
  });

  assert.deepEqual(tasks.map((task) => task.id), ["msn_run", "tsk_loop_1", "run_1", "msn_done"]);
  assert.equal(tasks[0].title, "分析仓库");
  assert.equal(tasks[0].description, "读取代码并生成结构报告");
  assert.deepEqual(tasks[0].actions, ["pause", "cancel"]);
  assert.deepEqual(tasks[1].actions, ["cancel"]);
  assert.deepEqual(tasks[2].actions, []);
  assert.equal(tasks[3].status, "succeeded");
  assert.deepEqual(tasks[3].actions, ["retry"]);
});

test("mission actions fail closed for retry without daemon", () => {
  assert.deepEqual(getMissionActions("failed", false), []);
  assert.deepEqual(getMissionActions("paused", false), ["resume", "cancel"]);
  assert.deepEqual(getMissionActions("running", false), ["pause", "cancel"]);
});
