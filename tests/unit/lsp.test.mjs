import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clampLspLimit,
  isLspEnabled,
  runLsp,
  resetTsServiceCache,
  lspTool,
} from "../../dist/tools/lsp.js";

test("lsp tool definition", () => {
  assert.equal(lspTool.name, "lsp");
  assert.equal(lspTool.readOnly, true);
});

test("isLspEnabled default off", () => {
  assert.equal(isLspEnabled({}), false);
  assert.equal(isLspEnabled({ QLING_LSP: "1" }), true);
});

test("runLsp refuses when disabled", async () => {
  const prev = process.env.QLING_LSP;
  delete process.env.QLING_LSP;
  try {
    const r = await runLsp({ action: "hover", path: "a.ts", line: 1, character: 1 });
    assert.equal(r.is_error, true);
    assert.match(String(r.output ?? r.error?.message ?? ""), /LSP_DISABLED|默认关闭|QLING_LSP/);
  } finally {
    if (prev === undefined) delete process.env.QLING_LSP;
    else process.env.QLING_LSP = prev;
  }
});

test("clampLspLimit caps context-heavy result counts", () => {
  assert.equal(clampLspLimit(undefined, 30), 30);
  assert.equal(clampLspLimit(0, 30), 30);
  assert.equal(clampLspLimit(99999, 30), 200);
  assert.equal(clampLspLimit(12.8, 30), 12);
});

test("runLsp rejects absolute files outside runtime roots", async () => {
  const prev = {
    enabled: process.env.QLING_LSP,
    workspace: process.env.QLING_WORKSPACE_DIR,
    state: process.env.QLING_FILE_STATE_DIR,
    cache: process.env.QLING_FILE_CACHE_DIR,
  };
  const workspace = await mkdtemp(join(tmpdir(), "qling-lsp-root-"));
  const outside = await mkdtemp(join(tmpdir(), "qling-lsp-outside-"));
  try {
    const outsideFile = join(outside, "secret.ts");
    await writeFile(outsideFile, "export const secret = 42;\n", "utf8");
    process.env.QLING_LSP = "1";
    process.env.QLING_WORKSPACE_DIR = workspace;
    process.env.QLING_FILE_STATE_DIR = join(workspace, ".state");
    process.env.QLING_FILE_CACHE_DIR = join(workspace, ".cache");

    const result = await runLsp({ action: "document_symbols", path: outsideFile });
    assert.equal(result.is_error, true);
    assert.match(String(result.output ?? result.error?.message ?? ""), /LSP_PATH_OUTSIDE_ROOTS/);
  } finally {
    for (const [key, value] of Object.entries({
      QLING_LSP: prev.enabled,
      QLING_WORKSPACE_DIR: prev.workspace,
      QLING_FILE_STATE_DIR: prev.state,
      QLING_FILE_CACHE_DIR: prev.cache,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetTsServiceCache();
    await rm(workspace, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("runLsp document_symbols and definition on temp ts file", async () => {
  const prev = process.env.QLING_LSP;
  process.env.QLING_LSP = "1";
  resetTsServiceCache();
  const dir = await mkdtemp(join(tmpdir(), "qling-lsp-"));
  const prevCwd = process.cwd();
  try {
    await mkdir(join(dir, "src"), { recursive: true });
    const file = join(dir, "src", "demo.ts");
    // line 1: export function greet...
    await writeFile(
      file,
      [
        "export function greet(name: string): string {",
        "  return 'hi ' + name;",
        "}",
        "export const x = greet('qling');",
        "",
      ].join("\n"),
      "utf8"
    );
    process.chdir(dir);
    process.env.QLING_WORKSPACE_DIR = dir;

    const syms = await runLsp({
      action: "document_symbols",
      path: "src/demo.ts",
    });
    assert.ok(!syms.is_error, syms.output);
    assert.match(String(syms.output), /greet/);

    // hover on greet at line 1 — approximate character of name
    const hover = await runLsp({
      action: "hover",
      path: "src/demo.ts",
      line: 1,
      character: 17,
    });
    assert.ok(!hover.is_error, hover.output);

    const def = await runLsp({
      action: "definition",
      path: "src/demo.ts",
      line: 4,
      character: 16,
    });
    assert.ok(!def.is_error, def.output);
    // definition of greet usage should point near line 1
    assert.match(String(def.output), /demo\.ts|greet|definition/i);
  } finally {
    process.chdir(prevCwd);
    resetTsServiceCache();
    delete process.env.QLING_WORKSPACE_DIR;
    if (prev === undefined) delete process.env.QLING_LSP;
    else process.env.QLING_LSP = prev;
    await rm(dir, { recursive: true, force: true });
  }
});

test("runLsp refreshes symbols after a file changes", async () => {
  const prevEnabled = process.env.QLING_LSP;
  const prevWorkspace = process.env.QLING_WORKSPACE_DIR;
  const dir = await mkdtemp(join(tmpdir(), "qling-lsp-refresh-"));
  resetTsServiceCache();
  try {
    const file = join(dir, "demo.ts");
    await writeFile(file, "export function oldName() { return 1; }\n", "utf8");
    process.env.QLING_LSP = "1";
    process.env.QLING_WORKSPACE_DIR = dir;

    const before = await runLsp({ action: "document_symbols", path: "demo.ts" });
    assert.match(String(before.output), /oldName/);

    await writeFile(file, "export function newName() { return 2; }\n", "utf8");
    const after = await runLsp({ action: "document_symbols", path: "demo.ts" });
    assert.match(String(after.output), /newName/);
    assert.doesNotMatch(String(after.output), /oldName/);
  } finally {
    resetTsServiceCache();
    if (prevEnabled === undefined) delete process.env.QLING_LSP;
    else process.env.QLING_LSP = prevEnabled;
    if (prevWorkspace === undefined) delete process.env.QLING_WORKSPACE_DIR;
    else process.env.QLING_WORKSPACE_DIR = prevWorkspace;
    await rm(dir, { recursive: true, force: true });
  }
});
