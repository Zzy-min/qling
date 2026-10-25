import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { RepoIndexService } from "../../dist/repo-index/service.js";

test("repo index ranks mentioned symbols and links tests to source", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qling-repo-index-"));
  const state = path.join(root, "state");
  const workspace = path.join(root, "workspace");
  await fs.mkdir(path.join(workspace, "src"), { recursive: true });
  await fs.mkdir(path.join(workspace, "tests"), { recursive: true });
  await fs.writeFile(path.join(workspace, "src", "math.ts"), "export function add(a: number, b: number) { return a + b; }\n");
  await fs.writeFile(path.join(workspace, "src", "index.ts"), "export { add } from './math.js';\n");
  await fs.writeFile(path.join(workspace, "tests", "math.test.ts"), "import { add } from '../src/math.js';\nvoid add(1, 2);\n");
  try {
    const service = new RepoIndexService({ workspaceDir: workspace, stateDir: state });
    const snapshot = await service.build();
    assert.ok(snapshot.files.some((file) => file.path === "src/math.ts"));
    assert.ok(snapshot.symbols.some((symbol) => symbol.name === "add"));
    assert.ok(snapshot.edges.some((edge) => edge.kind === "tests"));

    const map = await service.renderMap({ mentioned: ["add"], tokenBudget: 250 });
    assert.match(map.text, /src\/math\.ts/);
    assert.ok(map.estimatedTokens <= 300);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("repo index invalidates changed files without scanning ignored data", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qling-repo-index-cache-"));
  const state = path.join(root, "state");
  const workspace = path.join(root, "workspace");
  await fs.mkdir(path.join(workspace, "node_modules", "ignored"), { recursive: true });
  await fs.writeFile(path.join(workspace, "main.py"), "def before():\n    return 1\n");
  await fs.writeFile(path.join(workspace, "node_modules", "ignored", "secret.py"), "def leaked():\n    pass\n");
  try {
    const service = new RepoIndexService({ workspaceDir: workspace, stateDir: state });
    const first = await service.build();
    await fs.writeFile(path.join(workspace, "main.py"), "def after():\n    return 2\n");
    const second = await service.build();
    assert.notEqual(first.dirtyFingerprint, second.dirtyFingerprint);
    assert.equal(second.symbols.some((symbol) => symbol.name === "before"), false);
    assert.equal(second.symbols.some((symbol) => symbol.name === "after"), true);
    assert.equal(second.symbols.some((symbol) => symbol.name === "leaked"), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
