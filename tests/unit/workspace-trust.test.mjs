import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getSkillDirs, runSkill } from "../../dist/tools/skill.js";
import { clearSkillCache } from "../../dist/skills/registry.js";
import { loadRoleCatalog } from "../../dist/agents/role-loader.js";
import { applyConfigToProcessEnv, buildDefaultConfig, loadQlingConfig } from "../../dist/config.js";
import { parseCliArgs } from "../../dist/cli/startup-contract.js";
import { runTrustCommand, runUntrustCommand } from "../../dist/cli/trust-control.js";
import {
  claimUntrustedWorkspaceHint,
  isWorkspaceTrusted,
  listTrustedWorkspaces,
  normalizeTrustPath,
  resetWorkspaceTrustHintsForTests,
  trustWorkspace,
  trustedWorkspacesFile,
  untrustWorkspace,
} from "../../dist/guard/workspace-trust.js";

const isolatedEnv = { QLING_TRUST_ALL_WORKSPACES: "false" };

function skillText(name, body) {
  return `---\nname: ${name}\ndescription: ${name} skill\n---\n\n${body}\n`;
}

async function roleFile(dir, id, title) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${id}.json`), JSON.stringify({
    id,
    title,
    base_role: "explore",
    description: title,
  }));
}

test("untrusted workspace does not load project skills or project agents", async () => {
  const root = await mkdtemp(join(tmpdir(), "qling-trust-skip-"));
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  const prev = {
    cwd: process.cwd(),
    home: process.env.QLING_HOME,
    trust: process.env.QLING_TRUST_ALL_WORKSPACES,
  };
  try {
    await mkdir(join(home, ".qling", "skills"), { recursive: true });
    await mkdir(join(workspace, "skills"), { recursive: true });
    await writeFile(join(home, ".qling", "skills", "user-only.md"), skillText("user-only", "USER_ONLY_BODY"));
    await writeFile(join(workspace, "skills", "project-only.md"), skillText("project-only", "PROJECT_ONLY_BODY"));
    await roleFile(join(root, "state", "agents"), "user-role", "from user");
    await roleFile(join(workspace, ".qling", "agents"), "project-role", "from project");
    process.env.QLING_HOME = home;
    process.env.QLING_TRUST_ALL_WORKSPACES = "false";
    process.chdir(workspace);
    clearSkillCache();
    const dirs = getSkillDirs({ cwd: workspace, homeDir: home, env: isolatedEnv });
    assert.equal(dirs.some((dir) => dir.replace(/\\/g, "/").endsWith("/workspace/skills")), false);
    const userSkill = await runSkill({ name: "user-only" });
    const projectSkill = await runSkill({ name: "project-only" });
    assert.match(userSkill.output, /USER_ONLY_BODY/);
    assert.equal(projectSkill.is_error, true);
    assert.match(projectSkill.output, /SKILL_NOT_FOUND/);
    const catalog = await loadRoleCatalog({ workspaceDir: workspace, homeDir: home, stateDir: join(root, "state") });
    assert.equal(catalog.get("user-role")?.source, "user");
    assert.equal(catalog.has("project-role"), false);
    assert.equal(isWorkspaceTrusted(workspace, { homeDir: home, env: isolatedEnv }), false);
  } finally {
    process.chdir(prev.cwd);
    if (prev.home === undefined) delete process.env.QLING_HOME;
    else process.env.QLING_HOME = prev.home;
    if (prev.trust === undefined) delete process.env.QLING_TRUST_ALL_WORKSPACES;
    else process.env.QLING_TRUST_ALL_WORKSPACES = prev.trust;
    clearSkillCache();
    await rm(root, { recursive: true, force: true });
  }
});

test("trusted workspace loads project skills and agents, and child directories inherit", async () => {
  const root = await mkdtemp(join(tmpdir(), "qling-trust-ok-"));
  const home = join(root, "home");
  const parent = join(root, "parent");
  const child = join(parent, "child");
  try {
    await roleFile(join(child, ".qling", "agents"), "nested-role", "from child");
    await mkdir(join(child, "skills"), { recursive: true });
    await writeFile(join(child, "skills", "nested.md"), skillText("nested", "NESTED_BODY"));
    await trustWorkspace(parent, { homeDir: home, env: isolatedEnv });
    assert.equal(isWorkspaceTrusted(child, { homeDir: home, env: isolatedEnv }), true);
    const dirs = getSkillDirs({ cwd: child, homeDir: home, env: isolatedEnv });
    assert.ok(dirs.some((dir) => dir.replace(/\\/g, "/").endsWith("/child/skills")));
    const catalog = await loadRoleCatalog({ workspaceDir: child, homeDir: home, stateDir: join(root, "state") });
    assert.equal(catalog.get("nested-role")?.source, "workspace");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("trust follows real paths and ignores a junction that points outside", async () => {
  const root = await mkdtemp(join(tmpdir(), "qling-trust-link-"));
  const home = join(root, "home");
  const trusted = join(root, "trusted");
  const outside = join(root, "outside");
  const child = join(trusted, "child");
  const missing = join(trusted, "missing-child");
  const sibling = join(root, "trustedX");
  const linkOut = join(trusted, "link-out");
  const linkIn = join(root, "link-in");
  const options = { homeDir: home, env: isolatedEnv };
  try {
    await mkdir(child, { recursive: true });
    await mkdir(outside, { recursive: true });
    await mkdir(sibling, { recursive: true });
    await trustWorkspace(trusted, options);
    assert.equal(isWorkspaceTrusted(child, options), true);
    assert.equal(isWorkspaceTrusted(missing, options), true);
    assert.equal(isWorkspaceTrusted(outside, options), false);
    assert.equal(isWorkspaceTrusted(sibling, options), false);
    if (process.platform === "win32") {
      assert.equal(isWorkspaceTrusted(trusted.toUpperCase(), options), true);
    }

    const linkType = process.platform === "win32" ? "junction" : "dir";
    let linksReady = false;
    try {
      await symlink(outside, linkOut, linkType);
      await symlink(trusted, linkIn, linkType);
      linksReady = true;
    } catch (error) {
      console.log(`symlink/junction assertions skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (linksReady) {
      assert.equal(isWorkspaceTrusted(linkOut, options), false);
      assert.equal(isWorkspaceTrusted(join(linkOut, "nested"), options), false);
      assert.equal(isWorkspaceTrusted(linkIn, options), true);
      assert.equal(isWorkspaceTrusted(join(linkIn, "child"), options), true);
      const file = trustedWorkspacesFile(options);
      await writeFile(file, `${linkOut}\n`, "utf8");
      assert.equal(isWorkspaceTrusted(outside, options), true);
      assert.equal(isWorkspaceTrusted(trusted, options), false);
      assert.equal(isWorkspaceTrusted(sibling, options), false);
    }
  } finally {
    await rm(linkOut, { force: true }).catch(() => undefined);
    await rm(linkIn, { force: true }).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test("similar path prefixes are not trusted", async () => {
  const root = await mkdtemp(join(tmpdir(), "qling-trust-prefix-"));
  const home = join(root, "home");
  const parent = join(root, "a");
  const sibling = join(root, "ab");
  const child = join(parent, "nested");
  try {
    await mkdir(parent, { recursive: true });
    await mkdir(sibling, { recursive: true });
    await trustWorkspace(parent, { homeDir: home, env: isolatedEnv });
    assert.equal(isWorkspaceTrusted(parent, { homeDir: home, env: isolatedEnv }), true);
    assert.equal(isWorkspaceTrusted(child, { homeDir: home, env: isolatedEnv }), true);
    assert.equal(isWorkspaceTrusted(sibling, { homeDir: home, env: isolatedEnv }), false);
    const file = await readFile(trustedWorkspacesFile({ homeDir: home, env: isolatedEnv }), "utf8");
    assert.match(file, /#/);
    assert.match(file, new RegExp(normalizeTrustPath(parent).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("windows trust matching ignores case and skips comments", async () => {
  const root = await mkdtemp(join(tmpdir(), "qling-trust-case-"));
  const home = join(root, "home");
  const workspace = join(root, "Work");
  try {
    await mkdir(workspace, { recursive: true });
    const file = trustedWorkspacesFile({ homeDir: home, env: isolatedEnv });
    await mkdir(join(home, ".qling"), { recursive: true });
    const line = process.platform === "win32" ? normalizeTrustPath(workspace).toUpperCase() : normalizeTrustPath(workspace);
    await writeFile(file, `# not a path\n# ${join(root, "other")}\n${line}\n`, "utf8");
    assert.equal(isWorkspaceTrusted(workspace, { homeDir: home, env: isolatedEnv }), true);
    assert.equal(isWorkspaceTrusted(join(root, "other"), { homeDir: home, env: isolatedEnv }), false);
    if (process.platform === "win32") {
      assert.equal(isWorkspaceTrusted(workspace.toUpperCase(), { homeDir: home, env: isolatedEnv }), true);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("project skill never overrides a same-named user skill, even when trusted or trust-all", async () => {
  const root = await mkdtemp(join(tmpdir(), "qling-trust-priority-"));
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  const prev = {
    cwd: process.cwd(),
    home: process.env.QLING_HOME,
    trust: process.env.QLING_TRUST_ALL_WORKSPACES,
  };
  try {
    await mkdir(join(home, ".qling", "skills"), { recursive: true });
    await mkdir(join(workspace, "skills"), { recursive: true });
    await writeFile(join(home, ".qling", "skills", "same.md"), skillText("same", "USER_SKILL_BODY"));
    await writeFile(join(workspace, "skills", "same.md"), skillText("same", "PROJECT_SKILL_BODY"));
    await trustWorkspace(workspace, { homeDir: home, env: isolatedEnv });
    process.env.QLING_HOME = home;
    process.env.QLING_TRUST_ALL_WORKSPACES = "false";
    process.chdir(workspace);
    clearSkillCache();
    const trusted = await runSkill({ name: "same" });
    assert.match(trusted.output, /USER_SKILL_BODY/);
    assert.doesNotMatch(trusted.output, /PROJECT_SKILL_BODY/);
    process.env.QLING_TRUST_ALL_WORKSPACES = "true";
    clearSkillCache();
    const trustAll = await runSkill({ name: "same" });
    assert.match(trustAll.output, /USER_SKILL_BODY/);
    assert.doesNotMatch(trustAll.output, /PROJECT_SKILL_BODY/);
    const dirs = getSkillDirs({ cwd: workspace, homeDir: home, env: { QLING_TRUST_ALL_WORKSPACES: "true" } });
    const userIndex = dirs.findIndex((dir) => dir.replace(/\\/g, "/").endsWith("/home/.qling/skills"));
    const projectIndex = dirs.findIndex((dir) => dir.replace(/\\/g, "/").endsWith("/workspace/skills"));
    assert.ok(userIndex >= 0 && projectIndex > userIndex);
  } finally {
    process.chdir(prev.cwd);
    if (prev.home === undefined) delete process.env.QLING_HOME;
    else process.env.QLING_HOME = prev.home;
    if (prev.trust === undefined) delete process.env.QLING_TRUST_ALL_WORKSPACES;
    else process.env.QLING_TRUST_ALL_WORKSPACES = prev.trust;
    clearSkillCache();
    await rm(root, { recursive: true, force: true });
  }
});

test("QLING_TRUST_ALL_WORKSPACES=true restores project skill loading", async () => {
  const root = await mkdtemp(join(tmpdir(), "qling-trust-all-"));
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  try {
    await mkdir(join(workspace, "skills"), { recursive: true });
    await writeFile(join(workspace, "skills", "only.md"), skillText("only", "PROJECT_RESTORED"));
    const blocked = getSkillDirs({ cwd: workspace, homeDir: home, env: isolatedEnv });
    assert.equal(blocked.some((dir) => dir.replace(/\\/g, "/").endsWith("/workspace/skills")), false);
    const restored = getSkillDirs({
      cwd: workspace,
      homeDir: home,
      env: { QLING_TRUST_ALL_WORKSPACES: "true" },
    });
    assert.ok(restored.some((dir) => dir.replace(/\\/g, "/").endsWith("/workspace/skills")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("untrusted workspace hint names qling trust and is emitted once per workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "qling-trust-hint-"));
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  resetWorkspaceTrustHintsForTests();
  try {
    await mkdir(workspace, { recursive: true });
    const first = claimUntrustedWorkspaceHint(workspace, { homeDir: home, env: isolatedEnv });
    const second = claimUntrustedWorkspaceHint(workspace, { homeDir: home, env: isolatedEnv });
    assert.match(first, /qling trust \[dir\]/);
    assert.match(first, /trusted-workspaces/);
    assert.match(first, /QLING_TRUST_ALL_WORKSPACES=true/);
    assert.match(first, /qling\.config 不能打开/);
    assert.doesNotMatch(first, /trust\.all_workspaces/);
    assert.equal(second, null);
    await trustWorkspace(workspace, { homeDir: home, env: isolatedEnv });
    resetWorkspaceTrustHintsForTests();
    assert.equal(claimUntrustedWorkspaceHint(workspace, { homeDir: home, env: isolatedEnv }), null);
  } finally {
    resetWorkspaceTrustHintsForTests();
    await rm(root, { recursive: true, force: true });
  }
});

test("qling trust and untrust commands edit only the injected home", async () => {
  const root = await mkdtemp(join(tmpdir(), "qling-trust-cli-"));
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  const logs = [];
  const original = console.log;
  console.log = (line) => logs.push(String(line));
  try {
    await mkdir(workspace, { recursive: true });
    assert.equal(await runTrustCommand(["--list"], { cwd: workspace, homeDir: home, env: isolatedEnv }), 0);
    assert.deepEqual(await listTrustedWorkspaces({ homeDir: home, env: isolatedEnv }), []);
    assert.equal(await runTrustCommand([], { cwd: workspace, homeDir: home, env: isolatedEnv }), 0);
    assert.equal(isWorkspaceTrusted(join(workspace, "sub"), { homeDir: home, env: isolatedEnv }), true);
    assert.equal(await runUntrustCommand([workspace], { cwd: root, homeDir: home, env: isolatedEnv }), 0);
    assert.equal(isWorkspaceTrusted(workspace, { homeDir: home, env: isolatedEnv }), false);
    const listed = parseCliArgs(["trust", "--list"]);
    const untrust = parseCliArgs(["untrust", workspace]);
    const hooks = parseCliArgs(["hooks", "disable", "sample"]);
    assert.equal(listed.mode, "trust");
    assert.deepEqual(listed.subArgs, ["--list"]);
    assert.equal(untrust.mode, "untrust");
    assert.equal(hooks.mode, "hooks");
    assert.deepEqual(hooks.subArgs, ["disable", "sample"]);
    assert.equal(parseCliArgs(["信任"]).mode, "trust");
    assert.equal(buildDefaultConfig().trust.all_workspaces, false);
    void logs;
  } finally {
    console.log = original;
    await rm(root, { recursive: true, force: true });
  }
});

function snapshotQlingEnv() {
  const saved = {};
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("QLING_")) saved[key] = process.env[key];
  }
  return saved;
}

function restoreQlingEnv(saved) {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("QLING_") && !Object.prototype.hasOwnProperty.call(saved, key)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("project qling.config cannot enable trust.all_workspaces", async () => {
  const root = await mkdtemp(join(tmpdir(), "qling-trust-config-"));
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  const prevCwd = process.cwd();
  const savedEnv = snapshotQlingEnv();
  try {
    await mkdir(join(workspace, "skills"), { recursive: true });
    await writeFile(join(workspace, "skills", "proj.md"), skillText("proj", "PROJECT_BODY"));
    await writeFile(join(workspace, "qling.config.yaml"), "trust:\n  all_workspaces: true\n");
    process.chdir(workspace);
    delete process.env.QLING_TRUST_ALL_WORKSPACES;
    process.env.QLING_HOME = home;
    const loaded = await loadQlingConfig({});
    assert.equal(loaded.config.trust.all_workspaces, false);
    assert.match(loaded.warnings.join("\n"), /QLING_TRUST_ALL_WORKSPACES/);
    applyConfigToProcessEnv(loaded.config);
    assert.equal(process.env.QLING_TRUST_ALL_WORKSPACES, "false");
    const blocked = getSkillDirs({
      cwd: workspace,
      homeDir: home,
      env: { QLING_TRUST_ALL_WORKSPACES: "false" },
    });
    assert.equal(blocked.some((dir) => dir.replace(/\\/g, "/").endsWith("/workspace/skills")), false);

    const viaFlag = await loadQlingConfig({
      configPath: join(workspace, "qling.config.yaml"),
      workspaceDir: workspace,
    }, {});
    assert.equal(viaFlag.config.trust.all_workspaces, false);
    assert.match(viaFlag.warnings.join("\n"), /trust\.all_workspaces/);

    process.env.QLING_TRUST_ALL_WORKSPACES = "true";
    const defaults = buildDefaultConfig();
    assert.equal(defaults.trust.all_workspaces, false);
    applyConfigToProcessEnv(defaults);
    assert.equal(process.env.QLING_TRUST_ALL_WORKSPACES, "true");
    const restored = getSkillDirs({
      cwd: workspace,
      homeDir: home,
      env: { QLING_TRUST_ALL_WORKSPACES: "true" },
    });
    assert.ok(restored.some((dir) => dir.replace(/\\/g, "/").endsWith("/workspace/skills")));
    const fromEnv = await loadQlingConfig({}, { QLING_TRUST_ALL_WORKSPACES: "true" });
    assert.equal(fromEnv.config.trust.all_workspaces, true);
  } finally {
    process.chdir(prevCwd);
    restoreQlingEnv(savedEnv);
    clearSkillCache();
    await rm(root, { recursive: true, force: true });
  }
});

test("untrust removes only the exact entry", async () => {
  const root = await mkdtemp(join(tmpdir(), "qling-trust-untrust-"));
  const home = join(root, "home");
  const parent = join(root, "parent");
  const child = join(parent, "child");
  try {
    await trustWorkspace(parent, { homeDir: home, env: isolatedEnv });
    await trustWorkspace(child, { homeDir: home, env: isolatedEnv });
    assert.equal(await untrustWorkspace(child, { homeDir: home, env: isolatedEnv }), true);
    assert.equal(isWorkspaceTrusted(child, { homeDir: home, env: isolatedEnv }), true);
    assert.equal(await untrustWorkspace(parent, { homeDir: home, env: isolatedEnv }), true);
    assert.equal(isWorkspaceTrusted(child, { homeDir: home, env: isolatedEnv }), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
