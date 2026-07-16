import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRoleCatalog } from "../../dist/agents/role-loader.js";

test("role catalog precedence is workspace over user over built-in", async () => {
  const root = await mkdtemp(join(tmpdir(), "qling-roles-"));
  const home = join(root, "home");
  const state = join(root, "state");
  const workspace = join(root, "workspace");
  await mkdir(join(state, "agents"), { recursive: true });
  await mkdir(join(workspace, ".qling", "agents"), { recursive: true });
  await writeFile(join(state, "agents", "custom.json"), JSON.stringify({
    id: "custom",
    title: "user",
    base_role: "explore",
  }));
  await writeFile(join(workspace, ".qling", "agents", "custom.md"), [
    "---",
    "id: custom",
    "title: workspace",
    "base_role: review",
    "allowed_tools: [read, write]",
    "---",
    "Review locally.",
  ].join("\n"));
  try {
    const catalog = await loadRoleCatalog({ workspaceDir: workspace, stateDir: state, homeDir: home });
    const custom = catalog.get("custom");
    assert.equal(custom.source, "workspace");
    assert.equal(custom.baseRole, "review");
    assert.deepEqual(custom.allowedTools, ["read"]);
    assert.equal(custom.canWrite, false);
    assert.match(custom.prompt, /Review locally/);
    assert.ok(catalog.has("implement"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
