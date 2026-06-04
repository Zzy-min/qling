import test from "node:test";
import assert from "node:assert/strict";

import { renderAgentsView } from "../../dist/cli/mission-views.js";

test("mission views: agents view groups missions by working / needs input / completed", () => {
  const output = renderAgentsView([
    {
      id: "msn-running",
      name: "Run task",
      description: "running task",
      status: "running",
      sessionId: "s1",
      lastContext: [],
      metrics: { startTime: 1, totalTurns: 0, totalTokens: 0, totalToolCalls: 0 },
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: "msn-paused",
      name: "Paused task",
      description: "paused task",
      status: "paused",
      sessionId: "s2",
      lastContext: [],
      metrics: { startTime: 1, totalTurns: 0, totalTokens: 0, totalToolCalls: 0 },
      createdAt: 2,
      updatedAt: 2,
    },
    {
      id: "msn-succeeded",
      name: "Done task",
      description: "done task",
      status: "succeeded",
      sessionId: "s3",
      lastContext: [],
      metrics: { startTime: 1, totalTurns: 0, totalTokens: 0, totalToolCalls: 0 },
      createdAt: 3,
      updatedAt: 3,
    },
  ]);

  assert.match(output, /Working/);
  assert.match(output, /Needs Input/);
  assert.match(output, /Completed/);
  assert.match(output, /msn-running/);
  assert.match(output, /msn-paused/);
  assert.match(output, /msn-succeeded/);
});
