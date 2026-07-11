import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchCodeSymbols, codeSymbolsTool } from "../../dist/tools/code-symbols.js";

test("code_symbols tool definition", () => {
  assert.equal(codeSymbolsTool.name, "code_symbols");
  assert.equal(codeSymbolsTool.readOnly, true);
});

test("searchCodeSymbols finds function by name", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-sym-"));
  try {
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(
      join(dir, "src", "a.ts"),
      "export function alphaBeta() { return 1; }\nexport class Gamma {}\n",
      "utf8"
    );
    const r = await searchCodeSymbols({
      workspaceDir: dir,
      query: "alpha",
    });
    assert.ok(!r.error);
    assert.ok(r.hits.some((h) => h.name === "alphaBeta"));
    const cls = await searchCodeSymbols({
      workspaceDir: dir,
      query: "Gamma",
      type: "class",
    });
    assert.ok(cls.hits.some((h) => h.type === "class" && h.name === "Gamma"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("searchCodeSymbols empty query error path via missing name", async () => {
  const r = await searchCodeSymbols({
    workspaceDir: process.cwd(),
    query: "___no_such_symbol_xyz_qling___",
    path: "src",
  });
  assert.equal(r.hits.length, 0);
});

test("searchCodeSymbols truncates traversal on non-code node budget", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-sym-budget-"));
  try {
    for (let i = 0; i < 12; i++) {
      const child = join(dir, `folder-${String(i).padStart(2, "0")}`);
      await mkdir(child, { recursive: true });
      await writeFile(join(child, "notes.txt"), "not code", "utf8");
    }
    const result = await searchCodeSymbols({
      workspaceDir: dir,
      query: "anything",
      maxNodes: 5,
    });
    assert.equal(result.scanned, 0);
    assert.equal(result.truncated, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
