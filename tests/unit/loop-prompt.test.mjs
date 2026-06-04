import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resolveLoopPrompt, DEFAULT_MAINTENANCE_PROMPT } from "../../dist/session/loop-prompt.js";

test("loop prompt prefers project .claude/loop.md over home config", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qling-loop-prompt-"));
  const projectDir = path.join(root, "workspace");
  const homeDir = path.join(root, "home");
  await fs.mkdir(path.join(projectDir, ".claude"), { recursive: true });
  await fs.mkdir(path.join(homeDir, ".claude"), { recursive: true });
  await fs.writeFile(path.join(projectDir, ".claude", "loop.md"), "project prompt", "utf-8");
  await fs.writeFile(path.join(homeDir, ".claude", "loop.md"), "home prompt", "utf-8");

  const result = await resolveLoopPrompt({ workspaceDir: projectDir, homeDir });
  assert.equal(result.source, "project");
  assert.equal(result.prompt, "project prompt");
});

test("loop prompt falls back to built-in maintenance prompt", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qling-loop-default-"));
  const result = await resolveLoopPrompt({ workspaceDir: root, homeDir: root });
  assert.equal(result.source, "builtin");
  assert.equal(result.prompt, DEFAULT_MAINTENANCE_PROMPT);
});
