import test from "node:test";
import assert from "node:assert/strict";

import { buildEvalSmokeTasks } from "../../dist/eval/tasks.js";
import { formatEvalReport, runEvalSuite } from "../../dist/eval/runner.js";

test("eval smoke tasks are non-empty", () => {
  const tasks = buildEvalSmokeTasks();
  assert.ok(tasks.length >= 8);
  assert.ok(tasks.every((t) => t.id && t.title && typeof t.run === "function"));
});

test("runEvalSuite passes local smoke suite", async () => {
  const report = await runEvalSuite();
  const text = formatEvalReport(report).join("\n");
  assert.equal(report.fail, 0, text);
  assert.ok(report.pass >= 8);
  assert.match(text, /eval:smoke passed/);
});
