import test from "node:test";
import assert from "node:assert/strict";

import { parseCliArgs, buildHelpText } from "../../dist/cli/startup-contract.js";

test("cli: no args defaults to chat (TUI)", () => {
  const result = parseCliArgs([]);
  assert.equal(result.kind, "ok");
  assert.equal(result.mode, "chat");
});

test("cli: --help has highest priority", () => {
  const result = parseCliArgs(["--help", "--repl", "--once", "x"]);
  assert.equal(result.kind, "ok");
  assert.equal(result.mode, "help");
});

test("cli: explicit subcommands route correctly", () => {
  const chat = parseCliArgs(["chat"]);
  const repl = parseCliArgs(["repl"]);
  const run = parseCliArgs(["run", "fix bug"]);
  assert.equal(chat.kind, "ok");
  assert.equal(chat.mode, "chat");
  assert.equal(repl.kind, "ok");
  assert.equal(repl.mode, "repl");
  assert.equal(run.kind, "ok");
  assert.equal(run.mode, "run");
  assert.equal(run.task, "fix bug");
});

test("cli: positional task remains valid for one-shot execution (compat)", () => {
  const result = parseCliArgs(["修复", "bug"]);
  assert.equal(result.kind, "ok");
  assert.equal(result.mode, "run");
  assert.equal(result.task, "修复 bug");
});

test("cli: conflict returns CLI_INVALID_MODE_COMBINATION with exit code 2", () => {
  const result = parseCliArgs(["repl", "--once", "x"]);
  assert.equal(result.kind, "error");
  assert.equal(result.code, "CLI_INVALID_MODE_COMBINATION");
  assert.equal(result.exitCode, 2);
});

test("cli: missing --once task returns CLI_MISSING_TASK with exit code 2", () => {
  const result = parseCliArgs(["--once"]);
  assert.equal(result.kind, "error");
  assert.equal(result.code, "CLI_MISSING_TASK");
  assert.equal(result.exitCode, 2);
});

test("cli: run without task returns CLI_MISSING_TASK", () => {
  const result = parseCliArgs(["run"]);
  assert.equal(result.kind, "error");
  assert.equal(result.code, "CLI_MISSING_TASK");
});

test("cli: help text includes subcommands and compatibility hints", () => {
  const help = buildHelpText("qingling");
  assert.match(help, /qingling run "你的任务"/);
  assert.match(help, /兼容别名/);
  assert.match(help, /CLI_INVALID_MODE_COMBINATION/);
});
