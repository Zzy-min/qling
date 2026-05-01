// ============================================================
// Approval Gate 单元测试
// ============================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ApprovalGate, ApprovalRequiredError } from "../../dist/guard/approval.js";

describe("ApprovalGate", () => {
  it("should resolve with allow decision", async () => {
    const gate = new ApprovalGate();
    const channel = {
      requestApproval: async () => ({
        requestId: "req-1",
        decision: "allow",
        timestamp: Date.now(),
      }),
    };

    const result = await gate.requestApproval(
      { id: "req-1", toolName: "bash", arguments: {}, reason: "dangerous", timestamp: Date.now() },
      channel,
      1000
    );

    assert.equal(result.decision, "allow");
    assert.equal(result.requestId, "req-1");
    assert.equal(gate.getPendingCount(), 0);
  });

  it("should resolve with deny decision", async () => {
    const gate = new ApprovalGate();
    const channel = {
      requestApproval: async () => ({
        requestId: "req-2",
        decision: "deny",
        timestamp: Date.now(),
      }),
    };

    const result = await gate.requestApproval(
      { id: "req-2", toolName: "bash", arguments: {}, reason: "dangerous", timestamp: Date.now() },
      channel,
      1000
    );

    assert.equal(result.decision, "deny");
  });

  it("should auto-deny on timeout", async () => {
    const gate = new ApprovalGate();
    const channel = {
      requestApproval: async () => new Promise(() => {}),
    };

    const result = await gate.requestApproval(
      { id: "req-3", toolName: "bash", arguments: {}, reason: "dangerous", timestamp: Date.now() },
      channel,
      200 // 200ms timeout for testing
    );

    assert.equal(result.decision, "deny");
    assert.equal(gate.getPendingCount(), 0);
  });

  it("should cancel all pending", async () => {
    const gate = new ApprovalGate();
    const channel = {
      requestApproval: async () => new Promise(() => {}),
    };

    const p1 = gate.requestApproval(
      { id: "req-4", toolName: "bash", arguments: {}, reason: "r1", timestamp: Date.now() },
      channel,
      5000
    );
    const p2 = gate.requestApproval(
      { id: "req-5", toolName: "bash", arguments: {}, reason: "r2", timestamp: Date.now() },
      channel,
      5000
    );

    gate.cancelAll();

    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(r1.decision, "deny");
    assert.equal(r2.decision, "deny");
    assert.equal(gate.getPendingCount(), 0);
  });
});

describe("ApprovalRequiredError", () => {
  it("should create error with correct fields", () => {
    const err = new ApprovalRequiredError("tc-1", "bash", ["dangerous command"]);
    assert.equal(err.name, "ApprovalRequiredError");
    assert.equal(err.toolCallId, "tc-1");
    assert.equal(err.toolName, "bash");
    assert.deepEqual(err.reasons, ["dangerous command"]);
  });
});
