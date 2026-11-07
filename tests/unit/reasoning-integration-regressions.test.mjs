import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { dispatch } from "../../dist/tools/index.js";
import { runWithRuntimeRoots } from "../../dist/runtime-paths.js";
import { RuntimeServices } from "../../dist/runtime-services.js";
import { loadWorkspaceTaskPlan } from "../../dist/plan/task-plan.js";
import { runTodo, loadWorkspaceTodoState } from "../../dist/tools/todo.js";
import { runPlanner } from "../../dist/tools/planner.js";
import { GoalEvaluator } from "../../dist/session/goal-evaluator.js";
import { SessionGoalController } from "../../dist/session/goal-controller.js";
import { SessionGoalManager } from "../../dist/session/session-goal-manager.js";

async function fixture(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "qling-state-boundary-"));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const a = path.join(temp, "a"), b = path.join(temp, "b");
  await Promise.all([fs.mkdir(a), fs.mkdir(b)]);
  return { a, b, roots: { workspaceDir: a, fileCacheDir: a, fileStateDir: a } };
}

test("built-in dispatch binds planner, todo and write to the host root", async t => {
  const { a, b, roots } = await fixture(t);
  const previous = process.env.QLING_WORKSPACE_DIR;
  process.env.QLING_WORKSPACE_DIR = a;
  t.after(() => { if (previous === undefined) delete process.env.QLING_WORKSPACE_DIR; else process.env.QLING_WORKSPACE_DIR = previous; });
  const runtime = new RuntimeServices(null, null, { workspaceDir: a, fileCacheDir: a, stateDir: a, toolAllowlist: null });
  t.after(() => runtime.shutdown());
  for (const [i, send] of [dispatch, call => runWithRuntimeRoots(roots, () => dispatch(call)), runtime.dispatchTool].entries()) {
    const call = (name, args) => send({ id: String(i), name, arguments: { ...args, workspaceDir: b, __qling_workspace_dir: b } });
    const created = await call("planner", { goal: "goal" + i, steps: ["prepare", "check"] });
    assert.ok(!created.is_error, created.output);
    assert.equal(loadWorkspaceTaskPlan(a).objective, "goal" + i);
    const added = await call("todo", { action: "add", content: "todo" + i });
    assert.ok(!added.is_error, added.output);
    assert.equal(loadWorkspaceTodoState(a).pending, i + 1);
    const written = await call("write", { path: "sample" + i + ".txt", content: "local" });
    assert.ok(!written.is_error, written.output);
    assert.equal(await fs.readFile(path.join(a, "sample" + i + ".txt"), "utf8"), "local");
  }
  assert.deepEqual(await fs.readdir(b), []);
});

test("direct planning calls preserve old todo rows, action aliases, and both planner step formats", async t => {
  const { a } = await fixture(t);
  const file = path.join(a, ".qling-todos.json");
  await fs.writeFile(file, JSON.stringify([{ id: "old1", content: "review fixture", status: "in_progress", extension: 17 }]));
  const todo = args => runTodo({ ...args, workspaceDir: a });
  assert.match((await todo({ action: "list" })).output, /review fixture/);
  assert.deepEqual(loadWorkspaceTodoState(a).pendingTitles, ["old1:review fixture"]);
  assert.ok(!(await todo({ action: "done", id: "old1" })).is_error);
  assert.ok(!(await todo({ action: "add", content: "cancel me", id: "old2" })).is_error);
  assert.ok(!(await todo({ action: "cancel", id: "old2" })).is_error);
  assert.ok(!(await todo({ todos: [{ id: "new", title: "new title", dependsOn: ["old1"] }] })).is_error);
  const [old, cancelled, added] = JSON.parse(await fs.readFile(file));
  assert.equal(old.extension, 17);
  assert.deepEqual([old.id, old.title, old.content, old.status], ["old1", "review fixture", "review fixture", "completed"]);
  assert.equal(cancelled.status, "cancelled");
  assert.deepEqual(added.dependsOn, ["old1"]);
  const plan = args => runPlanner({ workspaceDir: a, ...args });
  assert.ok(!(await plan({ goal: "fixture", steps: ["one", "two"] })).is_error);
  assert.deepEqual(loadWorkspaceTaskPlan(a).steps.map(s => s.title), ["one", "two"]);
  assert.ok(!(await plan({ action: "replan", steps: [{ id: "x", title: "prepare" }, { id: "y", title: "check", dependsOn: ["x"] }] })).is_error);
  assert.deepEqual(loadWorkspaceTaskPlan(a).steps.find(s => s.id === "y").dependsOn, ["x"]);
});

for (const state of ["planner", "todo"]) {
  test(state + " confines linked state paths", async t => {
    const { a, b, roots } = await fixture(t);
    let target;
    if (state === "planner") {
      await fs.mkdir(path.join(b, "plans"));
      target = path.join(b, "plans", "active-plan.json");
    } else target = path.join(b, "todos.json");
    const sentinel = JSON.stringify(state === "planner" ? { objective: "sentinel", steps: [] } : [{ id: "guard", content: "sentinel", status: "pending" }]);
    await fs.writeFile(target, sentinel);
    try {
      if (state === "planner") await fs.symlink(b, path.join(a, ".qling"), process.platform === "win32" ? "junction" : "dir");
      else await fs.symlink(target, path.join(a, ".qling-todos.json"), "file");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) { t.skip(error.code + " creating local link"); return; }
      throw error;
    }
    const call = args => runWithRuntimeRoots(roots, () => dispatch({ id: "guard", name: state, arguments: args }));
    const read = await call({ action: state === "planner" ? "get" : "list" });
    assert.doesNotMatch(read.output, /sentinel/);
    const update = await call(state === "planner" ? { goal: "local", steps: ["one"] } : { action: "add", title: "local" });
    assert.equal(update.is_error, true);
    assert.equal(await fs.readFile(target, "utf8"), sentinel);
  });
}

test("production goal controller passes bounded UTF-8 tool evidence to the evaluator request", async t => {
  const { a } = await fixture(t);
  let sent;
  const evaluator = new GoalEvaluator({ provider: "local", endpoint: "http://localhost/fixture", apiKey: "", fetchImpl: async (_url, init) => {
    sent = JSON.parse(init.body).messages[0].content.split("【Transcript】\n").at(-1);
    return Response.json({ choices: [{ message: { content: '{"done":true,"reason":"observed"}' } }] });
  } });
  const manager = new SessionGoalManager({ stateDir: a, sessionId: "bounded" });
  const controller = new SessionGoalController({ manager, evaluator, evidenceGoals: false });
  await controller.init();
  await controller.setGoal("check local proof", { turnCount: 0, tokens: 0 });
  const transcript = SessionGoalController.messagesToTranscript([
    { role: "assistant", content: "", tool_calls: [{ id: "r1", type: "function", function: { name: "verify", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "r1", content: "local proof, exit 0" },
    ...Array.from({ length: 10 }, () => ({ role: "assistant", content: "中💡".repeat(4096) })),
    { role: "assistant", content: "A".repeat(40000) },
  ]);
  const outcome = await controller.afterTurn({ transcript, stats: { turnCount: 1, tokens: 1 } });
  assert.equal(outcome.status, "achieved");
  assert.equal(sent, transcript);
  assert.match(sent, /\[tool_result\].*r1.*verify.*local proof, exit 0/);
  assert.match(sent, /\[agent_message\].*untrusted/);
  assert.ok(Buffer.byteLength(sent) <= 32768);
  for (const item of sent.split("\n\n")) assert.ok(Buffer.byteLength(item) <= 4096);
  assert.doesNotMatch(sent, /\uFFFD/);
  const chinese = SessionGoalController.messagesToTranscript([{ role: "assistant", content: "中".repeat(4096) }]);
  assert.ok(Buffer.byteLength(chinese) <= 4096);
  await evaluator.evaluate({ condition: "direct string compatibility", transcript: "💡".repeat(15000) + "end" });
  assert.ok(Buffer.byteLength(sent) <= 32768);
  assert.ok(sent.endsWith("end"));
  assert.doesNotMatch(sent, /\uFFFD/);
});
