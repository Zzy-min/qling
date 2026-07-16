import test from "node:test";
import assert from "node:assert/strict";

import { resolveResumeMode, resumeCommand } from "../../dist/commands/resume.js";

test("resolveResumeMode: bare and pick open picker", () => {
  assert.deepEqual(resolveResumeMode([]), { kind: "picker" });
  assert.deepEqual(resolveResumeMode(["pick"]), { kind: "picker" });
  assert.deepEqual(resolveResumeMode(["ui"]), { kind: "picker" });
  assert.deepEqual(resolveResumeMode(["切换"]), { kind: "picker" });
});

test("resolveResumeMode: latest vs id", () => {
  assert.deepEqual(resolveResumeMode(["latest"]), { kind: "latest" });
  assert.deepEqual(resolveResumeMode(["last"]), { kind: "latest" });
  assert.deepEqual(resolveResumeMode(["continue"]), { kind: "latest" });
  assert.deepEqual(resolveResumeMode(["session-123"]), { kind: "id", id: "session-123" });
});

test("resumeCommand bare opens session picker when available", async () => {
  let opened = 0;
  const lines = [];
  await resumeCommand.execute([], {
    openSessionPicker: () => {
      opened += 1;
    },
    writeLine: (l = "") => lines.push(l),
    writeError: (l = "") => lines.push(l),
    agentLoop: {},
  });
  assert.equal(opened, 1);
  // TUI 路径不应刷多余提示行
  assert.equal(lines.length, 0);
});

test("withDefaultWriters preserves openSessionPicker for resume", async () => {
  const { withDefaultWriters } = await import("../../dist/slash-context.js");
  let opened = 0;
  const ctx = withDefaultWriters({
    agentLoop: {},
    openSessionPicker: () => {
      opened += 1;
    },
    writeLine: () => {},
    writeError: () => {},
  });
  await resumeCommand.execute([], ctx);
  assert.equal(opened, 1);
});

test("resumeCommand latest restores without opening picker", async () => {
  let opened = 0;
  let switched;
  const lines = [];
  await resumeCommand.execute(["latest"], {
    openSessionPicker: () => {
      opened += 1;
    },
    switchSession: async (target) => {
      switched = target;
      return {
        name: "n",
        title: "t",
        sessionId: "session-latest",
        turnCount: 2,
        messageCount: 4,
      };
    },
    writeLine: (l = "") => lines.push(l),
    writeError: (l = "") => lines.push(l),
    agentLoop: {},
  });
  assert.equal(opened, 0);
  assert.equal(switched, undefined);
  assert.match(lines.join("\n"), /会话已恢复|session-latest/);
});
