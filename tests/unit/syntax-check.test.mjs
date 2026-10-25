import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { checkFileSyntax } from "../../dist/repo-index/syntax-check.js";

test("fast syntax check distinguishes valid and invalid TypeScript", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qling-syntax-"));
  try {
    const valid = path.join(root, "valid.ts");
    const invalid = path.join(root, "invalid.ts");
    await fs.writeFile(valid, "export const value: number = 1;\n");
    await fs.writeFile(invalid, "export function broken( {\n");
    assert.equal((await checkFileSyntax(valid)).ok, true);
    assert.equal((await checkFileSyntax(invalid)).ok, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("fast syntax check detects missing Python syntax tokens", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qling-syntax-python-"));
  try {
    const invalid = path.join(root, "invalid.py");
    await fs.writeFile(invalid, "def broken(:\n    pass\n");
    assert.equal((await checkFileSyntax(invalid)).ok, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
