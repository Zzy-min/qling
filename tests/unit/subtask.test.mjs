// ============================================================
// Subtask 隔离执行器单元测试
// ============================================================

import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { SubtaskRunner } from "../../dist/agent/subtask.js";
import { subtaskTool } from "../../dist/tools/subtask.js";

describe("subtask tool definition", () => {
  it("should have correct name", () => {
    assert.equal(subtaskTool.name, "subtask");
  });

  it("should require task parameter", () => {
    assert.deepEqual(subtaskTool.parameters.required, ["task"]);
  });

  it("should have planning scene", () => {
    assert.deepEqual(subtaskTool.scenes, ["planning"]);
  });

  it("should have high effort hint", () => {
    assert.equal(subtaskTool.effortHint, "high");
  });

  it("should define task property as string", () => {
    const props = subtaskTool.parameters.properties;
    assert.equal(props.task.type, "string");
  });

  it("should define optional context property", () => {
    const props = subtaskTool.parameters.properties;
    assert.equal(props.context.type, "string");
  });

  it("should define optional max_iterations as number", () => {
    const props = subtaskTool.parameters.properties;
    assert.equal(props.max_iterations.type, "number");
  });

  it("should not be readOnly", () => {
    assert.equal(subtaskTool.readOnly, false);
  });

  it("should not be destructive", () => {
    assert.equal(subtaskTool.destructive, false);
  });
});

describe("SubtaskRunner", () => {
  it("should be constructable with minimal config", () => {
    const runner = new SubtaskRunner({
      apiKey: "test-key",
      provider: "test",
      endpoint: "http://localhost",
      model: "test-model",
      tools: [],
    });
    assert.ok(runner);
  });
});
