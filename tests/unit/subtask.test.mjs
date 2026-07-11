// ============================================================
// Subtask 隔离执行器单元测试
// ============================================================

import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { SubtaskRunner, runWithTimeout } from "../../dist/agent/subtask.js";
import { subtaskTool } from "../../dist/tools/subtask.js";

describe("subtask tool definition", () => {
  it("should have correct name", () => {
    assert.equal(subtaskTool.name, "subtask");
  });

  it("should allow task or tasks without hard required array", () => {
    // task 与 tasks[] 二选一，由 runtime 校验
    assert.ok(Array.isArray(subtaskTool.parameters.required));
    assert.ok(subtaskTool.parameters.properties.task);
    assert.ok(subtaskTool.parameters.properties.tasks);
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

  it("should define optional role property", () => {
    const props = subtaskTool.parameters.properties;
    assert.equal(props.role.type, "string");
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

describe("runWithTimeout", () => {
  it("clears its timer when the operation succeeds", async () => {
    let cleared = false;
    const timers = {
      setTimeout: () => ({ fake: true }),
      clearTimeout: () => {
        cleared = true;
      },
    };

    const result = await runWithTimeout(Promise.resolve("ok"), 1000, timers);
    assert.equal(result, "ok");
    assert.equal(cleared, true);
  });

  it("rejects with the configured timeout and clears its timer", async () => {
    let cleared = false;
    let rejectTimer;
    const timers = {
      setTimeout: (fn) => {
        rejectTimer = fn;
        return { fake: true };
      },
      clearTimeout: () => {
        cleared = true;
      },
    };
    const pending = new Promise(() => {});
    const result = runWithTimeout(pending, 5, timers);
    rejectTimer();

    await assert.rejects(result, /Subtask timeout after 5ms/);
    assert.equal(cleared, true);
  });
});
