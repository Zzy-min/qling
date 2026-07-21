// ============================================================
// TuiChannel + 审批决策映射（chat 模式审批入口）
// ============================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TuiChannel } from "../../dist/channels/tui-channel.js";
import { ApprovalGate } from "../../dist/guard/approval.js";

describe("TuiChannel approval entry", () => {
  it("forwards allow from port to ApprovalGate", async () => {
    const port = {
      requestToolApproval: async (req) => ({
        requestId: req.id,
        decision: "allow",
        timestamp: Date.now(),
      }),
    };
    const channel = new TuiChannel(port);
    const gate = new ApprovalGate();
    const result = await gate.requestApproval(
      {
        id: "tc-1",
        toolName: "bash",
        arguments: { command: "ls" },
        reason: "ask",
        timestamp: Date.now(),
      },
      channel,
      2000
    );
    assert.equal(result.decision, "allow");
    assert.equal(result.requestId, "tc-1");
  });

  it("forwards deny from port", async () => {
    const port = {
      requestToolApproval: async (req) => ({
        requestId: req.id,
        decision: "deny",
        timestamp: Date.now(),
      }),
    };
    const channel = new TuiChannel(port);
    const gate = new ApprovalGate();
    const result = await gate.requestApproval(
      {
        id: "tc-2",
        toolName: "write",
        arguments: { path: "x" },
        reason: "ask",
        timestamp: Date.now(),
      },
      channel,
      2000
    );
    assert.equal(result.decision, "deny");
  });

  it("channel name is tui", () => {
    const channel = new TuiChannel({
      requestToolApproval: async (req) => ({
        requestId: req.id,
        decision: "deny",
        timestamp: Date.now(),
      }),
    });
    assert.equal(channel.name, "tui");
  });
});
