import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonHookRunner } from "../../dist/hooks/json-hooks.js";

test("JSON PreToolUse hook returns allow and writes metadata-only audit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-hook-"));
  try {
    const auditPath = join(dir, "audit", "events.jsonl");
    const runner = new JsonHookRunner({
      events: {
        PreToolUse: [{
          command: process.execPath,
          args: ["-e", "process.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({decision:'allow'})))"],
        }],
      },
    }, { workspaceDir: dir, auditPath, timeoutMs: 3000, maxOutputBytes: 4096 });
    const result = await runner.runPre({
      toolName: "read",
      arguments: { path: "secret-name.txt" },
      inputSchema: {},
      isReadOnly: true,
      isDestructive: false,
      isConcurrencySafe: true,
      dangerousPatterns: [],
    });
    assert.equal(result.decision, "allow");
    const audit = await readFile(auditPath, "utf8");
    assert.match(audit, /PreToolUse/);
    assert.doesNotMatch(audit, /secret-name/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("failed JSON PreToolUse hook requires explicit approval", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-hook-fail-"));
  try {
    const runner = new JsonHookRunner({
      events: { PreToolUse: [{ command: "definitely-not-a-real-command" }] },
    }, { workspaceDir: dir, auditPath: join(dir, "audit.jsonl"), timeoutMs: 500, maxOutputBytes: 1024 });
    const result = await runner.runPre({
      toolName: "write",
      arguments: {},
      inputSchema: {},
      isReadOnly: false,
      isDestructive: false,
      isConcurrencySafe: false,
      dangerousPatterns: [],
    });
    assert.equal(result.decision, "ask");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
