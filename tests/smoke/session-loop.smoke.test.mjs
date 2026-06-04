import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { handleSlashCommand } from "../../dist/commands/index.js";
import { SessionScheduler } from "../../dist/session/session-scheduler.js";

function createContext(rootDir, scheduler) {
  const lines = [];
  const errors = [];
  return {
    lines,
    errors,
    ctx: {
      agentLoop: {
        compactSessionNow: async () => ({ beforeCount: 1, afterCount: 1, changed: false }),
        getSessionId: () => "session-smoke",
        getRuntimeRootDir: () => rootDir,
      },
      scheduler,
      writeLine: (line = "") => lines.push(String(line)),
      writeError: (line = "") => errors.push(String(line)),
    },
  };
}

test("session loop smoke: create, list, cancel", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qling-loop-smoke-"));
  const workspaceDir = path.join(root, "workspace");
  await fs.mkdir(path.join(workspaceDir, ".claude"), { recursive: true });
  await fs.writeFile(path.join(workspaceDir, ".claude", "loop.md"), "maintenance prompt", "utf-8");

  const scheduler = new SessionScheduler({
    stateDir: root,
    sessionId: "session-smoke",
    workspaceDir,
    homeDir: root,
    onDue: async () => {},
  });
  await scheduler.init();

  const { ctx, lines } = createContext(root, scheduler);

  const created = await handleSlashCommand("/loop 1m 检查构建结果", ctx);
  assert.equal(created, true);
  let tasks = await scheduler.listTasks();
  assert.equal(tasks.length, 1);
  assert.match(lines.join("\n"), /1m|60/);

  lines.length = 0;
  const listed = await handleSlashCommand("/tasks", ctx);
  assert.equal(listed, true);
  assert.match(lines.join("\n"), /检查构建结果/);

  lines.length = 0;
  const canceled = await handleSlashCommand(`/tasks cancel ${tasks[0].id}`, ctx);
  assert.equal(canceled, true);
  tasks = await scheduler.listTasks();
  assert.equal(tasks[0].status, "canceled");
  assert.match(lines.join("\n"), new RegExp(tasks[0].id));
});
