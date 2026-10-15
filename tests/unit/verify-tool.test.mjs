import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { inspectProjectProfile, resolveVerificationCommand } from "../../dist/runtime/project-profile.js";
import { runVerify } from "../../dist/tools/verify.js";

test("project profile assigns stable command ids instead of requiring shell composition", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qling-verify-profile-"));
  try {
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
    const profile = await inspectProjectProfile({ workspaceDir: root, requestedRuntime: "native" });
    const command = profile.testCommands.find((item) => item.stage === "targeted");
    assert.match(command?.id ?? "", /^project:/);
    assert.equal(resolveVerificationCommand(profile, command.id), command);
    assert.equal(resolveVerificationCommand(profile, "project:unknown"), undefined);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("verify tool applies tail as an output view and preserves the full artifact", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qling-verify-tool-"));
  const state = await fs.mkdtemp(path.join(os.tmpdir(), "qling-verify-state-"));
  const previousWorkspace = process.env.QLING_WORKSPACE_DIR;
  const previousState = process.env.QLING_FILE_STATE_DIR;
  try {
    process.env.QLING_WORKSPACE_DIR = root;
    process.env.QLING_FILE_STATE_DIR = state;
    await fs.writeFile(path.join(root, "print-lines.mjs"), "console.log('one');\nconsole.log('two');\nconsole.log('three');\n");
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "node print-lines.mjs" } }));
    const profile = await inspectProjectProfile({ workspaceDir: root, requestedRuntime: "native" });
    const commandId = profile.testCommands.find((item) => item.stage === "targeted").id;
    const result = await runVerify({ verifierId: "unit", commandId, outputView: { mode: "tail", lines: 2 } });
    assert.equal(result.is_error, false);
    assert.doesNotMatch(result.output, /one/);
    assert.match(result.output, /two[\s\S]*three/);
    assert.doesNotMatch(result.output, /^npm notice\b/m);
    assert.match(String(result.meta?.artifactRef), /^[a-f0-9]{64}$/);
    assert.equal(result.meta?.verdict, "pass");
    const artifact = await fs.readFile(String(result.meta?.artifactPath), "utf8");
    assert.match(artifact, /(?:^|\n)one(?:\n|$)/);
    assert.match(artifact, /two/);
    assert.match(artifact, /three/);
  } finally {
    if (previousWorkspace === undefined) delete process.env.QLING_WORKSPACE_DIR; else process.env.QLING_WORKSPACE_DIR = previousWorkspace;
    if (previousState === undefined) delete process.env.QLING_FILE_STATE_DIR; else process.env.QLING_FILE_STATE_DIR = previousState;
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(state, { recursive: true, force: true });
  }
});

test("verify tool does not expose the model credential to repository scripts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qling-verify-secret-"));
  const state = await fs.mkdtemp(path.join(os.tmpdir(), "qling-verify-secret-state-"));
  const previous = { workspace: process.env.QLING_WORKSPACE_DIR, state: process.env.QLING_FILE_STATE_DIR, key: process.env.QLING_LLM_API_KEY };
  try {
    process.env.QLING_WORKSPACE_DIR = root;
    process.env.QLING_FILE_STATE_DIR = state;
    process.env.QLING_LLM_API_KEY = "should-not-leak";
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "node -e \"if(process.env.QLING_LLM_API_KEY) process.exit(9)\"" } }));
    const profile = await inspectProjectProfile({ workspaceDir: root, requestedRuntime: "native" });
    const result = await runVerify({ verifierId: "secret", commandId: profile.testCommands[0].id });
    assert.equal(result.meta?.verdict, "pass");
  } finally {
    if (previous.workspace === undefined) delete process.env.QLING_WORKSPACE_DIR; else process.env.QLING_WORKSPACE_DIR = previous.workspace;
    if (previous.state === undefined) delete process.env.QLING_FILE_STATE_DIR; else process.env.QLING_FILE_STATE_DIR = previous.state;
    if (previous.key === undefined) delete process.env.QLING_LLM_API_KEY; else process.env.QLING_LLM_API_KEY = previous.key;
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(state, { recursive: true, force: true });
  }
});

test("verify scope resolves a Python source file to its nearest test", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qling-verify-scope-"));
  const state = await fs.mkdtemp(path.join(os.tmpdir(), "qling-verify-scope-state-"));
  const previous = {
    workspace: process.env.QLING_WORKSPACE_DIR,
    state: process.env.QLING_FILE_STATE_DIR,
    runtime: process.env.QLING_CODE_RUNTIME,
  };
  try {
    await fs.mkdir(path.join(root, "pkg", "tests"), { recursive: true });
    await fs.writeFile(path.join(root, "pyproject.toml"), "[tool.pytest.ini_options]\n");
    await fs.writeFile(path.join(root, "pkg", "module.py"), "VALUE = 1\n");
    await fs.writeFile(path.join(root, "pkg", "tests", "test_module.py"), "def test_value():\n    assert True\n");
    process.env.QLING_WORKSPACE_DIR = root;
    process.env.QLING_FILE_STATE_DIR = state;
    process.env.QLING_CODE_RUNTIME = "native";
    const result = await runVerify({
      verifierId: "scope",
      commandId: "project:python:pytest",
      scope: ["pkg/module.py"],
      outputView: { mode: "tail", lines: 10 },
    });
    assert.equal(result.is_error, false);
    assert.deepEqual(result.meta?.scope, ["pkg/tests/test_module.py"]);
  } finally {
    if (previous.workspace === undefined) delete process.env.QLING_WORKSPACE_DIR; else process.env.QLING_WORKSPACE_DIR = previous.workspace;
    if (previous.state === undefined) delete process.env.QLING_FILE_STATE_DIR; else process.env.QLING_FILE_STATE_DIR = previous.state;
    if (previous.runtime === undefined) delete process.env.QLING_CODE_RUNTIME; else process.env.QLING_CODE_RUNTIME = previous.runtime;
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(state, { recursive: true, force: true });
  }
});

test("verify blocks a passing command that mutates the workspace", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qling-verify-mutates-"));
  const state = await fs.mkdtemp(path.join(os.tmpdir(), "qling-verify-mutates-state-"));
  const previous = { workspace: process.env.QLING_WORKSPACE_DIR, state: process.env.QLING_FILE_STATE_DIR };
  try {
    process.env.QLING_WORKSPACE_DIR = root;
    process.env.QLING_FILE_STATE_DIR = state;
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "node -e \"require('fs').writeFileSync('generated.txt','x')\"" } }));
    const profile = await inspectProjectProfile({ workspaceDir: root, requestedRuntime: "native" });
    const result = await runVerify({ verifierId: "ignored", mutationId: "m:1", commandId: profile.testCommands[0].id });
    assert.equal(result.is_error, true);
    assert.equal(result.meta?.verdict, "blocked");
    assert.equal(result.error?.code, "VERIFY_MUTATED_WORKSPACE");
  } finally {
    if (previous.workspace === undefined) delete process.env.QLING_WORKSPACE_DIR; else process.env.QLING_WORKSPACE_DIR = previous.workspace;
    if (previous.state === undefined) delete process.env.QLING_FILE_STATE_DIR; else process.env.QLING_FILE_STATE_DIR = previous.state;
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(state, { recursive: true, force: true });
  }
});
