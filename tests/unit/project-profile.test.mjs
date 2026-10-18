import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import {
  formatProjectProfile,
  inspectProjectProfile,
  inspectProjectProfileCached,
  resolveScopedVerificationCommand,
  resolveCodeRuntime,
  resolveProjectProfileIdentity,
  selectPythonExecutable,
  extractPythonBuildRequirements,
  extractPythonTestBootstrapModules,
} from "../../dist/runtime/project-profile.js";
import { hostIndependentPythonProbe } from "../helpers/python-probe.mjs";

test("project preflight discovers ecosystems, lockfiles, and deterministic tests", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qling-project-profile-"));
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "node --test", build: "tsc" } }));
  await fs.writeFile(path.join(root, "package-lock.json"), "{}");
  try {
    const profile = await inspectProjectProfile({ workspaceDir: root, requestedRuntime: "native" });
    assert.deepEqual(profile.ecosystems, ["node"]);
    assert.ok(profile.lockfiles.includes("package-lock.json"));
    assert.ok(profile.testCommands.some((command) => command.command === "npm test" && command.id === "project:node:test"));
    assert.equal(profile.runtime, "native");
    assert.equal(profile.revision, "nogit");
    assert.match(profile.dirtyFingerprint, /^[a-f0-9]{64}$/);
    assert.match(formatProjectProfile(profile), /environment: ready/);
    assert.match(formatProjectProfile(profile), /npm test/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("project preflight cache invalidates when a manifest changes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qling-project-profile-cache-"));
  const manifest = path.join(root, "package.json");
  await fs.writeFile(manifest, JSON.stringify({ scripts: { test: "node --test" } }));
  try {
    const beforeIdentity = await resolveProjectProfileIdentity(root);
    const before = await inspectProjectProfileCached({ workspaceDir: root, requestedRuntime: "native" });
    assert.ok(before.testCommands.some((item) => item.command === "npm test"));

    await fs.writeFile(manifest, JSON.stringify({ scripts: { build: "tsc" } }));
    const afterIdentity = await resolveProjectProfileIdentity(root);
    const after = await inspectProjectProfileCached({ workspaceDir: root, requestedRuntime: "native" });
    assert.notEqual(afterIdentity.dirtyFingerprint, beforeIdentity.dirtyFingerprint);
    assert.notStrictEqual(after, before);
    assert.equal(after.testCommands.some((item) => item.command === "npm test"), false);
    assert.ok(after.testCommands.some((item) => item.command === "npm run build"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("git-backed profile fingerprints distinguish successive edits with the same porcelain status", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qling-project-profile-git-"));
  const manifest = path.join(root, "package.json");
  await fs.writeFile(manifest, JSON.stringify({ scripts: { test: "node --test" } }));
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.email", "eval@example.invalid"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Qling Eval"], { cwd: root });
    execFileSync("git", ["add", "package.json"], { cwd: root });
    execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });

    await fs.writeFile(manifest, JSON.stringify({ scripts: { test: "node --test tests/a.mjs" } }));
    const first = await resolveProjectProfileIdentity(root);
    await fs.writeFile(manifest, JSON.stringify({ scripts: { test: "node --test tests/b.mjs" } }));
    const second = await resolveProjectProfileIdentity(root);
    assert.equal(first.revision, second.revision);
    assert.notEqual(first.dirtyFingerprint, second.dirtyFingerprint);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("runtime resolution prefers WSL for POSIX-only benchmark profiles without installing it", () => {
  assert.equal(resolveCodeRuntime({ requested: "auto", platform: "win32", posixRequired: true, wslAvailable: true }), "wsl");
  assert.equal(resolveCodeRuntime({ requested: "auto", platform: "win32", posixRequired: true, wslAvailable: false }), "native");
  assert.equal(resolveCodeRuntime({ requested: "native", platform: "win32", posixRequired: true, wslAvailable: true }), "native");
});

test("project preflight uses python3 when a runtime has no python alias", () => {
  assert.equal(selectPythonExecutable({ pythonAvailable: false, python3Available: true }), "python3");
  assert.equal(selectPythonExecutable({ pythonAvailable: true, python3Available: true }), "python");
  assert.equal(selectPythonExecutable({ pythonAvailable: false, python3Available: false }), null);
});

test("project preflight extracts and reports missing Python build requirements", async () => {
  assert.deepEqual(
    extractPythonBuildRequirements(`[build-system]\nrequires = ["setuptools",\n "setuptools_scm>=6.2", "extension-helpers"]\nbuild-backend = "setuptools.build_meta"\n`),
    ["setuptools", "setuptools_scm", "extension-helpers"],
  );
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qling-project-profile-build-req-"));
  try {
    await fs.writeFile(
      path.join(root, "pyproject.toml"),
      `[build-system]\nrequires = ["qling-definitely-missing-build-package"]\n[tool.pytest.ini_options]\n`,
    );
    const profile = await inspectProjectProfile({
      workspaceDir: root,
      requestedRuntime: "native",
      probe: hostIndependentPythonProbe({ allDistributionsUnavailable: true }),
    });
    assert.equal(profile.environmentStatus, "degraded");
    assert.match(profile.blockers.join("\n"), /qling-definitely-missing-build-package/);
    assert.ok(profile.testCommands.some((item) => item.id === "project:python:pytest"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("project preflight refuses to advertise pytest when conftest bootstrap dependencies are missing", async () => {
  assert.deepEqual(
    extractPythonTestBootstrapModules("import os\nfrom hypothesis import given\nfrom pkg.submodule import helper\n"),
    ["hypothesis", "os", "pkg"],
  );
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qling-project-profile-test-deps-"));
  try {
    await fs.writeFile(path.join(root, "pyproject.toml"), "[tool.pytest.ini_options]\n");
    await fs.writeFile(path.join(root, "conftest.py"), "import qling_definitely_missing_pytest_bootstrap\n");
    const profile = await inspectProjectProfile({
      workspaceDir: root,
      requestedRuntime: "native",
      probe: hostIndependentPythonProbe(),
    });
    assert.equal(profile.environmentStatus, "degraded");
    assert.match(profile.blockers.join("\n"), /qling_definitely_missing_pytest_bootstrap/);
    assert.equal(profile.testCommands.some((item) => item.id === "project:python:pytest"), false);
    assert.match(formatProjectProfile(profile), /do not repeatedly run unavailable verification/i);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("project preflight discovers pytest from a root test module without config files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qling-project-profile-root-test-"));
  try {
    await fs.writeFile(path.join(root, "setup.py"), "from setuptools import setup\nsetup(name='fixture')\n");
    await fs.writeFile(path.join(root, "test_requests.py"), "def test_fixture(): pass\n");
    const profile = await inspectProjectProfile({
      workspaceDir: root,
      requestedRuntime: "native",
      probe: hostIndependentPythonProbe(),
    });
    assert.ok(profile.testCommands.some((item) => item.id === "project:python:pytest"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("auto project inspection does not infer POSIX-only from tox or Makefile alone", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qling-project-profile-native-"));
  try {
    await fs.writeFile(path.join(root, "pyproject.toml"), "[tool.pytest.ini_options]\n");
    await fs.writeFile(path.join(root, "tox.ini"), "[tox]\n");
    await fs.writeFile(path.join(root, "Makefile"), "test:\n\tpython -m pytest\n");
    const profile = await inspectProjectProfile({ workspaceDir: root, requestedRuntime: "auto" });
    if (process.platform === "win32") assert.equal(profile.runtime, "native");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("project preflight maps a changed Python module to its nearest targeted test", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qling-project-profile-scope-"));
  try {
    await fs.mkdir(path.join(root, "astropy", "io", "ascii", "tests"), { recursive: true });
    await fs.writeFile(path.join(root, "pyproject.toml"), "[tool.pytest.ini_options]\n");
    await fs.writeFile(path.join(root, "astropy", "io", "ascii", "qdp.py"), "VALUE = 1\n");
    await fs.writeFile(path.join(root, "astropy", "io", "ascii", "tests", "test_qdp.py"), "def test_qdp(): pass\n");
    const profile = await inspectProjectProfile({
      workspaceDir: root,
      requestedRuntime: "native",
      probe: hostIndependentPythonProbe(),
    });
    const plan = await resolveScopedVerificationCommand({
      profile,
      workspaceDir: root,
      commandId: "project:python:pytest",
      changedPaths: ["astropy/io/ascii/qdp.py"],
      requireNarrowScope: true,
    });
    assert.equal(plan?.scope?.[0], "astropy/io/ascii/tests/test_qdp.py");
    assert.match(plan?.command ?? "", /^python -m pytest .+test_qdp\.py/);
    assert.match(formatProjectProfile(profile), /project:python:pytest/);
    assert.match(formatProjectProfile(profile), /verify.*commandId/i);
    assert.match(formatProjectProfile(profile), /repository-relative paths/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("scoped verification rejects absolute, parent, and symlink workspace escapes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qling-project-profile-escape-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "qling-project-profile-outside-"));
  try {
    await fs.writeFile(path.join(root, "pyproject.toml"), "[tool.pytest.ini_options]\n");
    await fs.writeFile(path.join(outside, "test_escape.py"), "raise RuntimeError('must not run')\n");
    const profile = {
      revision: "r", dirtyFingerprint: "d", parserVersion: "test", ecosystems: ["python"],
      manifests: ["pyproject.toml"], lockfiles: [], runtime: "native", environmentStatus: "ready", blockers: [],
      testCommands: [{ id: "project:python:pytest", stage: "targeted", command: "python -m pytest", reason: "fixture" }],
    };
    for (const escaped of [path.join(outside, "test_escape.py"), "../test_escape.py", "../../outside/test_escape.py"]) {
      assert.equal(await resolveScopedVerificationCommand({ profile, workspaceDir: root, commandId: "project:python:pytest", changedPaths: [escaped], requireNarrowScope: true }), undefined);
    }
    try {
      await fs.symlink(outside, path.join(root, "linked"), "junction");
      assert.equal(await resolveScopedVerificationCommand({ profile, workspaceDir: root, commandId: "project:python:pytest", changedPaths: ["linked/test_escape.py"], requireNarrowScope: true }), undefined);
    } catch {
      // Symlink creation may be unavailable on a locked-down Windows host.
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test("scoped verification falls back to a registered full verifier when narrowing is unavailable", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qling-project-profile-fallback-"));
  try {
    const nodeProfile = {
      revision: "fixture", dirtyFingerprint: "clean", parserVersion: "test",
      ecosystems: ["node"], manifests: ["package.json"], lockfiles: [], runtime: "native", environmentStatus: "ready", blockers: [],
      testCommands: [{ id: "project:node:test", stage: "targeted", command: "npm test", executable: "npm", args: ["test"], reason: "fixture" }],
    };
    const nodePlan = await resolveScopedVerificationCommand({
      profile: nodeProfile,
      workspaceDir: root,
      commandId: "project:node:test",
      changedPaths: ["<unknown-background-outcome>"],
      requireNarrowScope: true,
    });
    assert.equal(nodePlan?.command, "npm test");
    assert.deepEqual(nodePlan?.args, ["test"]);
    assert.match(nodePlan?.reason ?? "", /full verifier fallback/);

    const pythonProfile = {
      ...nodeProfile,
      ecosystems: ["python"], manifests: ["pyproject.toml"],
      testCommands: [{ id: "project:python:pytest", stage: "targeted", command: "python -m pytest", executable: "python", args: ["-m", "pytest"], reason: "fixture" }],
    };
    const pythonPlan = await resolveScopedVerificationCommand({
      profile: pythonProfile,
      workspaceDir: root,
      commandId: "project:python:pytest",
      changedPaths: ["<unknown-background-outcome>"],
      requireNarrowScope: true,
    });
    assert.equal(pythonPlan?.command, "python -m pytest");
    assert.deepEqual(pythonPlan?.args, ["-m", "pytest"]);
    assert.match(pythonPlan?.reason ?? "", /full verifier fallback/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("project preflight selects the lockfile package manager", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qling-project-profile-pm-"));
  try {
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }));
    await fs.writeFile(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    const profile = await inspectProjectProfile({ workspaceDir: root, requestedRuntime: "native" });
    const command = profile.testCommands.find((item) => item.id === "project:node:test");
    if (command) assert.equal(command.command, "pnpm test");
    else assert.match(profile.blockers.join("\n"), /pnpm executable is unavailable/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("scoped verification preserves Windows metacharacters as an argv element", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qling-project-profile-argv-"));
  try {
    await fs.mkdir(path.join(root, "pkg", "tests"), { recursive: true });
    await fs.writeFile(path.join(root, "pkg", "%QLING_SCOPE_ESCAPE%.py"), "VALUE = 1\n");
    await fs.writeFile(path.join(root, "pkg", "tests", "test_%QLING_SCOPE_ESCAPE%.py"), "def test_value(): pass\n");
    const profile = {
      revision: "fixture", dirtyFingerprint: "fixture", parserVersion: "fixture",
      ecosystems: ["python"], manifests: ["pyproject.toml"], lockfiles: [],
      testCommands: [{ id: "project:python:pytest", stage: "targeted", command: "python -m pytest", executable: "python", args: ["-m", "pytest"], reason: "fixture" }],
      runtime: "native", environmentStatus: "ready", blockers: [],
    };
    const plan = await resolveScopedVerificationCommand({ profile, workspaceDir: root, commandId: "project:python:pytest", changedPaths: ["pkg/%QLING_SCOPE_ESCAPE%.py"], requireNarrowScope: true });
    assert.deepEqual(plan?.args, ["-m", "pytest", "pkg/tests/test_%QLING_SCOPE_ESCAPE%.py"]);
    assert.equal(plan?.executable, "python");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
