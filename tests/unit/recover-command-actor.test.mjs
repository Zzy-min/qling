import assert from "node:assert/strict";
import test from "node:test";
import { recoverCommand } from "../../dist/commands/recover.js";

test("/recover retry resumes an actor-only paused recovery after explicit confirmation", async () => {
  const lines = [];
  let resumed = 0;
  const agentLoop = {
    getRecoveryState: () => null,
    getRuntimeSnapshot: () => ({ state: "paused", pauseReason: "unconfirmed_mutating_tool_outcome", promptQueue: [{ id: "p", prompt: "resume", priority: "normal", queuedAt: 1 }] }),
    resumeRuntimeSession: async () => { resumed++; },
  };
  await recoverCommand.execute(["retry"], {
    agentLoop,
    writeLine: (line) => lines.push(String(line)),
    writeError: (line) => lines.push(`error:${line}`),
  });
  assert.equal(resumed, 1);
  assert.match(lines.join("\n"), /用户确认恢复/);
});
