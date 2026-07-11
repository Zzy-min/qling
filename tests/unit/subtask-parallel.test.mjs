import test from "node:test";
import assert from "node:assert/strict";
import {
  isSubtaskParallelEnabled,
  parseParallelTasks,
  gateParallelExplore,
  formatParallelExploreReport,
  resolveParallelMax,
} from "../../dist/agent/subtask-parallel.js";

test("isSubtaskParallelEnabled default off", () => {
  assert.equal(isSubtaskParallelEnabled({}), false);
  assert.equal(isSubtaskParallelEnabled({ QLING_SUBTASK_PARALLEL: "1" }), true);
});

test("parseParallelTasks array and string", () => {
  assert.deepEqual(parseParallelTasks(["a", "b"]), ["a", "b"]);
  assert.deepEqual(parseParallelTasks('["x","y"]'), ["x", "y"]);
  assert.deepEqual(parseParallelTasks("one\ntwo"), ["one", "two"]);
  assert.deepEqual(parseParallelTasks(""), []);
});

test("gateParallelExplore requires enable", () => {
  const g = gateParallelExplore({
    tasks: ["a", "b"],
    role: "explore",
    enabled: false,
  });
  assert.equal(g.ok, false);
  assert.equal(g.errorCode, "SUBTASK_PARALLEL_DISABLED");
});

test("gateParallelExplore blocks implement", () => {
  const g = gateParallelExplore({
    tasks: ["a", "b"],
    role: "implement",
    enabled: true,
  });
  assert.equal(g.ok, false);
  assert.equal(g.errorCode, "SUBTASK_PARALLEL_ROLE");
});

test("gateParallelExplore allows explore when enabled", () => {
  const g = gateParallelExplore({
    tasks: ["a", "b"],
    role: "explore",
    enabled: true,
    max: 3,
  });
  assert.equal(g.ok, true);
  assert.equal(g.role, "explore");
  assert.equal(g.tasks.length, 2);
});

test("gateParallelExplore caps max", () => {
  const g = gateParallelExplore({
    tasks: ["1", "2", "3", "4"],
    role: "explore",
    enabled: true,
    max: 3,
  });
  assert.equal(g.ok, false);
  assert.equal(g.errorCode, "SUBTASK_PARALLEL_TOO_MANY");
});

test("formatParallelExploreReport", () => {
  const text = formatParallelExploreReport([
    {
      task: "find login",
      result: {
        success: true,
        output: "x",
        contractText: "role: explore\nsummary: ok",
        iterations: 3,
        durationMs: 1,
        role: "explore",
        filesTouched: [],
      },
    },
  ]);
  assert.match(text, /并行探索回传/);
  assert.match(text, /find login/);
  assert.match(text, /ok/);
});

test("resolveParallelMax", () => {
  assert.equal(resolveParallelMax({}), 3);
  assert.equal(resolveParallelMax({ QLING_SUBTASK_PARALLEL_MAX: "5" }), 5);
});
