import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createStructuredTaskPlan, formatTaskPlanMarkdown, getReadyPlanSteps,
  loadWorkspaceTaskPlan, replanStructuredTaskPlan, summarizeTaskPlan, updatePlanStepStatus,
} from "../../dist/plan/task-plan.js";
import { runPlanner } from "../../dist/tools/planner.js";
import { loadTodos, loadWorkspaceTodoState, runTodo } from "../../dist/tools/todo.js";

const steps = () => [{ id: "a", title: "prepare" }, { id: "b", title: "deliver", dependsOn: ["a"] }];
const create = (input = steps()) => createStructuredTaskPlan({ objective: "deliver in order", steps: input });
async function workspace(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-plan-transitions-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

for (const status of ["in_progress", "verifying", "completed"]) {
  test(`create/update/replan reject ${status} with unmet dependency without mutating the plan`, () => {
    const incoming = steps();
    incoming[1].status = status;
    assert.throws(() => create(incoming), /dependenc.*a/i);
    const plan = create();
    const before = JSON.stringify(plan);
    assert.throws(() => updatePlanStepStatus(plan, "b", { status, verificationEvidence: "tests pass" }), /dependenc.*a/i);
    assert.throws(() => replanStructuredTaskPlan(plan, { reason: "retry", newSteps: incoming }), /dependenc.*a/i);
    assert.equal(JSON.stringify(plan), before);
  });
}

test("completed prerequisites permit progress but cannot be reopened underneath active dependents", () => {
  let plan = updatePlanStepStatus(create(), "a", { status: "completed", verificationEvidence: "reported preparation" });
  assert.deepEqual(getReadyPlanSteps(plan).map(step => step.id), ["b"]);
  for (const status of ["in_progress", "verifying", "completed"]) {
    const active = updatePlanStepStatus(plan, "b", { status });
    assert.throws(() => updatePlanStepStatus(active, "a", { status: "pending" }), /dependenc.*a/i);
  }
  plan = updatePlanStepStatus(plan, "b", { status: "completed", verificationEvidence: "reported delivery" });
  const summary = summarizeTaskPlan(plan);
  assert.equal(summary.isComplete, true); // Workflow report only, never deterministic verification.
  assert.equal(summary.completedSteps, 2);
  assert.equal(summary.verifiedSteps, 0);
  assert.equal(summary.verificationStatus, "unverified");
});

test("creation and replanning accept valid dependency states and preserve reported completions", () => {
  const plan = create([{ id: "a", title: "prepare", status: "completed" },
    { id: "b", title: "deliver", dependsOn: ["a"], status: "in_progress" }]);
  const revised = replanStructuredTaskPlan(plan, { reason: "replace delivery", newSteps: [
    { id: "c", title: "replacement", dependsOn: ["a"], status: "completed", verificationEvidence: "human note" },
  ] });
  assert.equal(revised.steps.find(step => step.id === "a").status, "completed");
  assert.equal(summarizeTaskPlan(revised).verifiedSteps, 0);
  assert.equal(summarizeTaskPlan(revised).completedSteps, 2);
});

test("replanning cannot silently remove an unresolved dependency from an active incoming step", () => {
  const plan = create();
  assert.throws(() => replanStructuredTaskPlan(plan, { reason: "remove preparation", newSteps: [
    { id: "b", title: "deliver", dependsOn: ["a"], status: "completed" },
  ] }), /dependenc.*a|unknown step.*a/i);
});

test("explicitly skipped prerequisites allow progress and do not prevent later replanning", () => {
  let plan = updatePlanStepStatus(create(), "a", { status: "skipped" });
  plan = updatePlanStepStatus(plan, "b", { status: "completed" });
  const revised = replanStructuredTaskPlan(plan, { reason: "add review", newSteps: ["review"] });
  assert.equal(revised.steps.find(step => step.id === "b").status, "completed");
  assert.equal(summarizeTaskPlan(revised).verifiedSteps, 0);
});

test("arbitrary evidence strings, skipped steps, and persisted legacy strings never count as verified", () => {
  const plan = create([{ id: "a", title: "reported", status: "completed", verificationEvidence: "verified via planner" },
    { id: "b", title: "waived", dependsOn: ["a"], status: "skipped" }]);
  plan.steps[0].verificationStatus = "verified"; // Untrusted legacy/JSON metadata cannot confer trust.
  assert.equal(summarizeTaskPlan(plan).verifiedSteps, 0);
  assert.equal(summarizeTaskPlan(plan).verificationStatus, "unverified");
  assert.match(formatTaskPlanMarkdown(plan), /未验证|unverified/);
  assert.doesNotMatch(formatTaskPlanMarkdown(plan), /验证证据: verified via planner/);
  assert.throws(() => create([{ id: "a", title: "forged", status: "verified" }]), /status/i);
  assert.throws(() => updatePlanStepStatus(create(), "a", { status: "verified" }), /status/i);
});

test("planner verify without evidence is actionable and never mutates persisted progress", async t => {
  const dir = await workspace(t);
  await runPlanner({ action: "create", goal: "deliver", steps: steps(), workspaceDir: dir });
  const before = JSON.stringify(loadWorkspaceTaskPlan(dir));
  for (const verificationEvidence of [undefined, "", "   "]) {
    const result = await runPlanner({ action: "verify_step", stepId: "b", verificationEvidence, workspaceDir: dir });
    assert.equal(result.is_error, true);
    assert.equal(result.error.code, "PLANNER_MISSING_EVIDENCE");
    assert.match(result.output, /update_step/);
    assert.match(result.output, /unverified/);
    assert.equal(JSON.stringify(loadWorkspaceTaskPlan(dir)), before);
  }
});

test("planner verify aliases record only unverified notes after prerequisites, and status reports that limit", async t => {
  const dir = await workspace(t);
  const run = args => runPlanner({ workspaceDir: dir, ...args });
  assert.ok(!(await run({ action: "create", goal: "deliver", steps: steps() })).is_error);
  assert.equal((await run({ action: "verify_step", stepId: "b", verificationEvidence: "reported done" })).is_error, true);
  assert.equal(loadWorkspaceTaskPlan(dir).steps[1].status, "pending");
  const first = await run({ action: "verify", stepId: "a", verificationEvidence: "prepared" });
  assert.ok(!first.is_error);
  assert.match(first.output, /未验证|unverified/);
  assert.doesNotMatch(first.output, /已验证计划步骤/);
  assert.ok(!(await run({ action: "verify_step", stepId: "b", verificationEvidence: "delivered" })).is_error);
  assert.equal(summarizeTaskPlan(loadWorkspaceTaskPlan(dir)).verifiedSteps, 0);
  const summary = await run({ action: "verify" });
  assert.match(summary.output, /未验证|unverified/);
  assert.match((await run({ action: "status" })).output, /未验证|unverified/);
});

test("planner strings and todo content/done/cancel compatibility remain available", async t => {
  const dir = await workspace(t);
  assert.ok(!(await runPlanner({ goal: "legacy", steps: ["one", "two"], workspaceDir: dir })).is_error);
  assert.deepEqual(loadWorkspaceTaskPlan(dir).steps.map(step => step.title), ["one", "two"]);
  const run = args => runTodo({ workspaceDir: dir, ...args });
  assert.ok(!(await run({ action: "add", content: "legacy row" })).is_error);
  const state = loadWorkspaceTodoState(dir);
  const id = loadTodos(dir)[0].id;
  assert.equal(state.total, 1);
  assert.ok(!(await run({ action: "done", id })).is_error);
  assert.equal(loadWorkspaceTodoState(dir).completed, 1);
  assert.ok(!(await run({ action: "add", content: "cancel row" })).is_error);
  const nextId = loadTodos(dir).find(row => row.title === "cancel row").id;
  assert.ok(!(await run({ action: "cancel", id: nextId })).is_error);
});
