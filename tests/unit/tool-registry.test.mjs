import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildToolRegistry, createToolDispatcher } from "../../dist/tools/index.js";
import { runWithRuntimeRoots } from "../../dist/runtime-paths.js";

test("tool registry: static disable takes effect", () => {
  const tools = buildToolRegistry({
    staticEnabled: {
      bash: false,
      read: true,
    },
  });
  const names = tools.map((t) => t.name);
  assert.equal(names.includes("bash"), false);
  assert.equal(names.includes("read"), true);
});

test("tool registry: runtime/channel layers are merged with overwrite-by-name", () => {
  const tools = buildToolRegistry({
    runtimeInjected: [{ name: "foo", description: "runtime", parameters: {} }],
    channelContextual: [{ name: "foo", description: "channel", parameters: {} }],
  });
  const foo = tools.find((t) => t.name === "foo");
  assert.ok(foo);
  assert.equal(foo.description, "channel");
});

test("tool registry: allowlist filters every registry layer", () => {
  const tools = buildToolRegistry({
    allowedNames: new Set(["read", "channel_only"]),
    runtimeInjected: [{ name: "runtime_only", description: "runtime", parameters: {} }],
    channelContextual: [{ name: "channel_only", description: "channel", parameters: {} }],
  });
  assert.deepEqual(tools.map((tool) => tool.name), ["read", "channel_only"]);
});

test("tool dispatcher: allowlist rejects a known but unavailable tool", async () => {
  const dispatch = createToolDispatcher({ allowedNames: new Set(["read"]) });
  const result = await dispatch({ id: "call-1", name: "bash", arguments: { command: "echo unsafe" } });
  assert.equal(result.tool_call_id, "call-1");
  assert.equal(result.is_error, true);
  assert.match(result.output, /not allowed/i);
});

test("tool dispatcher: concurrent agents resolve relative paths in isolated runtime contexts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qling-tool-context-"));
  const left = path.join(root, "left");
  const right = path.join(root, "right");
  await fs.mkdir(left);
  await fs.mkdir(right);
  await fs.writeFile(path.join(left, "same.txt"), "LEFT");
  await fs.writeFile(path.join(right, "same.txt"), "RIGHT");
  const dispatch = createToolDispatcher({ allowedNames: new Set(["read"]) });
  try {
    const [leftResult, rightResult] = await Promise.all([
      runWithRuntimeRoots({ workspaceDir: left, fileCacheDir: left, fileStateDir: left }, () => dispatch({ id: "left", name: "read", arguments: { path: "same.txt" } })),
      runWithRuntimeRoots({ workspaceDir: right, fileCacheDir: right, fileStateDir: right }, () => dispatch({ id: "right", name: "read", arguments: { path: "same.txt" } })),
    ]);
    assert.match(leftResult.output, /LEFT/);
    assert.match(rightResult.output, /RIGHT/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("tool registry: includes subtask tool in static layer", () => {
  const tools = buildToolRegistry();
  const names = tools.map((t) => t.name);
  assert.equal(names.includes("subtask"), true);
});

test("tool registry: includes browser_act in static layer", () => {
  const tools = buildToolRegistry();
  const names = tools.map((t) => t.name);
  assert.equal(names.includes("browser_act"), true);
});

test("tool registry: includes code_symbols in static layer", () => {
  const tools = buildToolRegistry();
  const names = tools.map((t) => t.name);
  assert.equal(names.includes("code_symbols"), true);
});

test("tool registry: includes lsp in static layer", () => {
  const tools = buildToolRegistry();
  const names = tools.map((t) => t.name);
  assert.equal(names.includes("lsp"), true);
});
