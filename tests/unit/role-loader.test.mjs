import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatLoadedRoles, loadRoleCatalog } from "../../dist/agents/role-loader.js";
import { trustWorkspace } from "../../dist/guard/workspace-trust.js";

test("user role wins over a same-named project role; other project roles still load", async () => {
  const root = await mkdtemp(join(tmpdir(), "qling-roles-"));
  const home = join(root, "home");
  const state = join(root, "state");
  const workspace = join(root, "workspace");
  const prevTrust = process.env.QLING_TRUST_ALL_WORKSPACES;
  await mkdir(join(state, "agents"), { recursive: true });
  await mkdir(join(workspace, ".qling", "agents"), { recursive: true });
  await writeFile(join(state, "agents", "custom.json"), JSON.stringify({
    id: "custom",
    title: "user",
    description: "from user",
    base_role: "explore",
  }));
  await trustWorkspace(workspace, { homeDir: home });
  await writeFile(join(workspace, ".qling", "agents", "custom.md"), [
    "---",
    "id: custom",
    "title: workspace",
    "base_role: review",
    "allowed_tools: [read, write]",
    "---",
    "Project should not win.",
  ].join("\n"));
  await writeFile(join(workspace, ".qling", "agents", "reviewer.md"), [
    "---",
    "id: reviewer",
    "title: workspace",
    "base_role: review",
    "allowed_tools: [read, write]",
    "---",
    "Review locally.",
  ].join("\n"));
  const errors = [];
  const origError = console.error;
  console.error = (...args) => {
    errors.push(args.map(String).join(" "));
  };
  try {
    process.env.QLING_TRUST_ALL_WORKSPACES = "false";
    const catalog = await loadRoleCatalog({ workspaceDir: workspace, stateDir: state, homeDir: home });
    const custom = catalog.get("custom");
    assert.equal(custom.source, "user");
    assert.equal(custom.title, "user");
    assert.equal(custom.baseRole, "explore");
    assert.equal(custom.prompt, undefined);
    const reviewer = catalog.get("reviewer");
    assert.equal(reviewer.source, "workspace");
    assert.equal(reviewer.baseRole, "review");
    assert.deepEqual(reviewer.allowedTools, ["read"]);
    assert.equal(reviewer.canWrite, false);
    assert.match(reviewer.prompt, /Review locally/);
    assert.equal(catalog.get("implement").source, "builtin");
    assert.match(errors.join("\n"), /custom/);
    assert.match(formatLoadedRoles(catalog), /同名时用户角色优先/);
    assert.match(formatLoadedRoles(catalog), /未受信工作区不加载项目角色/);
  } finally {
    console.error = origError;
    if (prevTrust === undefined) delete process.env.QLING_TRUST_ALL_WORKSPACES;
    else process.env.QLING_TRUST_ALL_WORKSPACES = prevTrust;
    await rm(root, { recursive: true, force: true });
  }
});

test("untrusted workspace does not load project roles", async () => {
  const root = await mkdtemp(join(tmpdir(), "qling-roles-untrusted-"));
  const home = join(root, "home");
  const state = join(root, "state");
  const workspace = join(root, "workspace");
  const prevTrust = process.env.QLING_TRUST_ALL_WORKSPACES;
  await mkdir(join(state, "agents"), { recursive: true });
  await mkdir(join(workspace, ".qling", "agents"), { recursive: true });
  await writeFile(join(state, "agents", "user-role.json"), JSON.stringify({
    id: "user-role",
    title: "from user",
    base_role: "explore",
  }));
  await writeFile(join(workspace, ".qling", "agents", "project-role.json"), JSON.stringify({
    id: "project-role",
    title: "from project",
    base_role: "review",
  }));
  try {
    process.env.QLING_TRUST_ALL_WORKSPACES = "false";
    const catalog = await loadRoleCatalog({ workspaceDir: workspace, stateDir: state, homeDir: home });
    assert.equal(catalog.get("user-role")?.source, "user");
    assert.equal(catalog.has("project-role"), false);
    assert.equal(catalog.get("explore").source, "builtin");
  } finally {
    if (prevTrust === undefined) delete process.env.QLING_TRUST_ALL_WORKSPACES;
    else process.env.QLING_TRUST_ALL_WORKSPACES = prevTrust;
    await rm(root, { recursive: true, force: true });
  }
});
