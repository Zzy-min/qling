import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { parseCliArgs } from "../../dist/cli/startup-contract.js";

const ENTRY = join(process.cwd(), "dist/index.js");

test("cli startup matrix smoke: parser-level route mapping", () => {
  const matrix = [
    { args: [], mode: "chat" },
    { args: ["chat"], mode: "chat" },
    { args: ["repl"], mode: "repl" },
    { args: ["run", "修复 bug"], mode: "run" },
    { args: ["修复 bug"], mode: "run" },
    { args: ["--once", "修复 bug"], mode: "run" },
    { args: ["--help"], mode: "help" },
  ];

  for (const row of matrix) {
    const result = parseCliArgs(row.args);
    assert.equal(result.kind, "ok");
    assert.equal(result.mode, row.mode);
  }
});

test("cli startup smoke: --help exits with code 0 and prints contract", () => {
  const result = spawnSync(process.execPath, [ENTRY, "--help"], { encoding: "utf-8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /默认进入流式 TUI/);
  assert.match(result.stdout, /run "你的任务"/);
});

test("cli startup smoke: conflict exits with code 2 and coded error", () => {
  const result = spawnSync(process.execPath, [ENTRY, "repl", "--once", "x"], {
    encoding: "utf-8",
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /CLI_INVALID_MODE_COMBINATION/);
});

test("cli startup smoke: --once missing task exits with code 2", () => {
  const result = spawnSync(process.execPath, [ENTRY, "--once"], { encoding: "utf-8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /CLI_MISSING_TASK/);
});
