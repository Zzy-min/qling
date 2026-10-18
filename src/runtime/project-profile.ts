import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type CodeRuntime = "auto" | "native" | "wsl";

export interface VerificationCommand {
  id: string;
  stage: "syntax" | "targeted" | "affected" | "full";
  command: string;
  executable?: string;
  args?: string[];
  reason: string;
}

export interface ScopedVerificationCommand extends VerificationCommand {
  scope?: string[];
}

export function resolveVerificationCommand(profile: ProjectProfile, commandId: string): VerificationCommand | undefined {
  return profile.testCommands.find((item) => item.id === commandId);
}

function quoteShellArgument(value: string, runtime: "native" | "wsl"): string {
  if (!/[\s"'&|<>^$`()\\]/.test(value)) return value;
  if (runtime === "wsl" || process.platform !== "win32") {
    return `'${value.replace(/'/g, `'\\''`)}'`;
  }
  return `"${value.replace(/"/g, '""')}"`;
}

async function isFile(filePath: string): Promise<boolean> {
  try { return (await fs.stat(filePath)).isFile(); } catch { return false; }
}

export async function resolveScopedVerificationCommand(input: {
  profile: ProjectProfile;
  workspaceDir: string;
  commandId: string;
  changedPaths?: string[];
  requireNarrowScope?: boolean;
}): Promise<ScopedVerificationCommand | undefined> {
  const registered = resolveVerificationCommand(input.profile, input.commandId);
  if (!registered) return undefined;
  const workspace = path.resolve(input.workspaceDir);
  let realWorkspace = workspace;
  try { realWorkspace = await fs.realpath(workspace); } catch { return undefined; }
  const changedPaths: string[] = [];
  for (const item of input.changedPaths ?? []) {
    const normalized = item.replace(/\\/g, "/");
    if (!normalized || path.posix.isAbsolute(normalized) || path.win32.isAbsolute(item)) return undefined;
    const resolved = path.resolve(workspace, normalized);
    const relative = path.relative(workspace, resolved);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return undefined;
    changedPaths.push(relative.replace(/\\/g, "/"));
  }
  if (registered.id !== "project:python:pytest" || changedPaths.length === 0) {
    return {
      ...registered,
      reason: input.requireNarrowScope
        ? `${registered.reason}; full verifier fallback because no safe narrow verifier is registered`
        : registered.reason,
    };
  }

  const candidates: string[] = [];
  for (const relative of changedPaths) {
    if (!relative.toLowerCase().endsWith(".py")) continue;
    const parsed = path.posix.parse(relative);
    if (/^test_.+\.py$/i.test(parsed.base) || /.+_test\.py$/i.test(parsed.base)) {
      candidates.push(relative);
      continue;
    }
    const testName = `test_${parsed.name}.py`;
    candidates.push(path.posix.join(parsed.dir, "tests", testName));
    candidates.push(path.posix.join(parsed.dir, testName));
  }
  const scope: string[] = [];
  for (const relative of [...new Set(candidates)]) {
    const candidate = path.resolve(workspace, relative);
    if (!await isFile(candidate)) continue;
    let realCandidate: string;
    try { realCandidate = await fs.realpath(candidate); } catch { continue; }
    const realRelative = path.relative(realWorkspace, realCandidate);
    if (realRelative === ".." || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) continue;
    scope.push(path.relative(workspace, candidate).replace(/\\/g, "/"));
  }
  if (scope.length === 0) {
    return {
      ...registered,
      reason: input.requireNarrowScope
        ? `${registered.reason}; full verifier fallback because no related test file was found`
        : registered.reason,
    };
  }
  return {
    ...registered,
    command: `${registered.command} ${scope.map((item) => quoteShellArgument(item, input.profile.runtime)).join(" ")}`,
    executable: registered.executable,
    args: registered.executable ? [...(registered.args ?? []), ...scope] : undefined,
    scope,
    reason: `${registered.reason}; nearest tests for current mutation`,
  };
}

export interface ProjectProfile {
  revision: string;
  dirtyFingerprint: string;
  parserVersion: string;
  ecosystems: string[];
  manifests: string[];
  lockfiles: string[];
  testCommands: VerificationCommand[];
  runtime: "native" | "wsl";
  environmentStatus: "ready" | "degraded" | "unsupported";
  blockers: string[];
}

const profileCache = new Map<string, Promise<ProjectProfile>>();
export const PROJECT_PROFILE_PARSER_VERSION = "project-profile-v3";

const PROFILE_FILES = [
  "package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb",
  "pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "tox.ini", "noxfile.py",
  "pytest.ini", "uv.lock", "poetry.lock", "Pipfile.lock", "Cargo.toml", "Cargo.lock", "go.mod",
  "go.sum", "pom.xml", "build.gradle", "build.gradle.kts", "gradlew", "gradlew.bat", "Makefile",
] as const;

const FALLBACK_IGNORED_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", ".venv", "venv", "target", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache"]);

async function listFallbackWorkspaceFiles(root: string, limit = 10_000): Promise<string[]> {
  const files: string[] = [];
  const queue = [root];
  while (queue.length > 0 && files.length < limit) {
    const current = queue.shift()!;
    let entries: import("node:fs").Dirent[];
    try { entries = await fs.readdir(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!FALLBACK_IGNORED_DIRS.has(entry.name)) queue.push(absolute);
      } else if (entry.isFile()) {
        files.push(path.relative(root, absolute).replace(/\\/g, "/"));
        if (files.length >= limit) break;
      }
    }
  }
  return files.sort();
}

async function hashFileState(root: string, relativePath: string, hash: ReturnType<typeof createHash>): Promise<void> {
  const absolutePath = path.resolve(root, relativePath);
  const relative = path.relative(root, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return;
  hash.update(relativePath.replace(/\\/g, "/"));
  try {
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) {
      hash.update("<not-file>");
      return;
    }
    if (stat.size <= 1024 * 1024) hash.update(await fs.readFile(absolutePath));
    else hash.update(`${stat.size}:${stat.mtimeMs}`);
  } catch {
    hash.update("<missing>");
  }
}

export async function resolveProjectProfileIdentity(workspaceDir: string): Promise<{
  revision: string;
  dirtyFingerprint: string;
}> {
  const root = path.resolve(workspaceDir);
  let revision = "nogit";
  let dirtyEntries: string[] = [];
  try {
    const head = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      windowsHide: true,
      timeout: 4000,
    });
    revision = head.stdout.trim() || "nogit";
    const status = await execFileAsync("git", ["-c", "core.quotepath=false", "status", "--porcelain=v1", "-z", "--untracked-files=all"], {
      cwd: root,
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 4 * 1024 * 1024,
    });
    dirtyEntries = status.stdout.split("\0").filter(Boolean);
  } catch {
    dirtyEntries = (await listFallbackWorkspaceFiles(root)).map((name) => `?? ${name}`);
  }

  const hash = createHash("sha256");
  hash.update(PROJECT_PROFILE_PARSER_VERSION);
  for (const entry of dirtyEntries.sort()) {
    hash.update(entry);
    const candidate = /^[ MADRCU?!]{2} /.test(entry) ? entry.slice(3) : entry;
    await hashFileState(root, candidate, hash);
  }
  return { revision, dirtyFingerprint: hash.digest("hex") };
}

export interface ProjectEnvironmentProbe {
  commandExists?: (command: string, runtime: "native" | "wsl") => Promise<boolean> | boolean;
  pythonModuleAvailable?: (
    executable: "python" | "python3",
    moduleName: string,
    runtime: "native" | "wsl",
    cwd?: string,
  ) => Promise<boolean> | boolean;
  pythonDistributionAvailable?: (
    executable: "python" | "python3",
    distribution: string,
    runtime: "native" | "wsl",
  ) => Promise<boolean> | boolean;
  /**
   * Test-only spawn prefix for the selected Python executable.
   * Displayed commands stay `python -m pytest`. Callers must pass this explicitly;
   * it is never read from the environment or model tool arguments.
   * Non-absolute executables are ignored.
   */
  pythonInvocation?: { executable: string; argsPrefix?: string[] };
}

export async function inspectProjectProfileCached(input: {
  workspaceDir: string;
  requestedRuntime?: CodeRuntime;
  posixRequired?: boolean;
  probe?: ProjectEnvironmentProbe;
}): Promise<ProjectProfile> {
  // A probe is a per-call test seam. Caching it would leak one test's
  // environment into another workspace with the same fingerprint.
  if (input.probe) return inspectProjectProfile(input);
  const identity = await resolveProjectProfileIdentity(input.workspaceDir);
  const key = [
    path.resolve(input.workspaceDir),
    input.requestedRuntime ?? "auto",
    input.posixRequired ?? "detect",
    identity.revision,
    identity.dirtyFingerprint,
    PROJECT_PROFILE_PARSER_VERSION,
  ].join("\0");
  const existing = profileCache.get(key);
  if (existing) return existing;
  const pending = inspectProjectProfile(input).catch((error) => {
    profileCache.delete(key);
    throw error;
  });
  profileCache.set(key, pending);
  return pending;
}

export function formatProjectProfile(profile: ProjectProfile): string {
  const commands = profile.testCommands
    .map((item) => `- ${item.stage} [${item.id}]: ${item.command} (${item.reason})`)
    .join("\n");
  const blockers = profile.blockers.map((item) => `- ${item}`).join("\n");
  return [
    '<project_preflight trust="workspace_data">',
    `revision: ${profile.revision}`,
    `dirty fingerprint: ${profile.dirtyFingerprint}`,
    `runtime: ${profile.runtime}`,
    "The runtime adapter already starts bash and verify in the workspace. Use repository-relative paths; do not prepend cd or translate Windows paths to /mnt paths.",
    `environment: ${profile.environmentStatus}`,
    `ecosystems: ${profile.ecosystems.join(", ") || "unknown"}`,
    `manifests: ${profile.manifests.join(", ") || "none"}`,
    `lockfiles: ${profile.lockfiles.join(", ") || "none"}`,
    commands ? `verification commands:\n${commands}` : "verification commands: none discovered",
    commands ? "After a mutation, call verify with verifierId, mutationId, and one listed commandId; do not rebuild ad-hoc test harnesses first." : "",
    blockers ? `blockers:\n${blockers}` : "blockers: none",
    "Do not install missing system dependencies automatically. Treat blockers as environment evidence, not implementation failure; do not repeatedly run unavailable verification.",
    "</project_preflight>",
  ].join("\n");
}

export function resolveCodeRuntime(input: {
  requested: CodeRuntime;
  platform: NodeJS.Platform;
  posixRequired: boolean;
  wslAvailable: boolean;
}): "native" | "wsl" {
  if (input.requested === "native" || input.requested === "wsl") return input.requested;
  return input.platform === "win32" && input.posixRequired && input.wslAvailable ? "wsl" : "native";
}

export function selectPythonExecutable(input: {
  pythonAvailable: boolean;
  python3Available: boolean;
}): "python" | "python3" | null {
  if (input.pythonAvailable) return "python";
  if (input.python3Available) return "python3";
  return null;
}

export function extractPythonBuildRequirements(pyproject: string): string[] {
  const section = pyproject.match(/(?:^|\n)\s*\[build-system\]\s*\n([\s\S]*?)(?=\n\s*\[|$)/i)?.[1] ?? "";
  const body = section.match(/\brequires\s*=\s*\[([\s\S]*?)\]/i)?.[1] ?? "";
  const names = new Set<string>();
  for (const match of body.matchAll(/["']([^"']+)["']/g)) {
    const distribution = match[1]
      .split(";", 1)[0]
      .split("[", 1)[0]
      .split(/[<>=!~\s]/, 1)[0]
      .trim();
    if (distribution) names.add(distribution);
  }
  return [...names];
}

async function exists(root: string, name: string): Promise<boolean> {
  try { return (await fs.stat(path.join(root, name))).isFile(); } catch { return false; }
}

async function commandExists(command: string, runtime: "native" | "wsl" = "native"): Promise<boolean> {
  if (runtime === "wsl" && process.platform === "win32") {
    try {
      await execFileAsync("wsl.exe", ["sh", "-lc", `command -v ${command}`], { windowsHide: true, timeout: 4000 });
      return true;
    } catch { return false; }
  }
  const executable = process.platform === "win32" ? "where.exe" : "which";
  try {
    await execFileAsync(executable, [command], { windowsHide: true, timeout: 4000 });
    return true;
  } catch { return false; }
}

async function pythonModuleAvailable(
  executable: "python" | "python3",
  moduleName: string,
  runtime: "native" | "wsl",
  cwd?: string,
): Promise<boolean> {
  const script = `import importlib.util,sys;sys.exit(0 if importlib.util.find_spec(${JSON.stringify(moduleName)}) else 1)`;
  try {
    if (runtime === "wsl" && process.platform === "win32") {
      const wslArgs = cwd ? ["--cd", cwd, "sh", "-lc", `${executable} -c '${script}'`] : ["sh", "-lc", `${executable} -c '${script}'`];
      await execFileAsync("wsl.exe", wslArgs, { windowsHide: true, timeout: 5_000 });
    } else {
      await execFileAsync(executable, ["-c", script], { cwd, windowsHide: true, timeout: 5_000 });
    }
    return true;
  } catch {
    return false;
  }
}

export function extractPythonTestBootstrapModules(source: string): string[] {
  const modules = new Set<string>();
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    const imported = line.match(/^import\s+([A-Za-z_][\w.]*)/)?.[1]
      ?? line.match(/^from\s+([A-Za-z_][\w.]*)\s+import\s+/)?.[1];
    if (imported) modules.add(imported.split(".", 1)[0]);
  }
  return [...modules].sort();
}

async function findPythonTestBootstrapModules(root: string, files: readonly string[]): Promise<string[]> {
  const modules = new Set<string>();
  for (const relative of files.filter((name) => path.posix.basename(name) === "conftest.py").slice(0, 64)) {
    try {
      for (const moduleName of extractPythonTestBootstrapModules(await fs.readFile(path.join(root, relative), "utf8"))) modules.add(moduleName);
    } catch {
      // Pytest will report unreadable bootstrap files directly.
    }
  }
  return [...modules].sort();
}

async function scanPythonTestLayout(root: string): Promise<{ hasTests: boolean; conftestFiles: string[]; truncated: boolean }> {
  const queue: Array<{ absolute: string; underTests: boolean }> = [{ absolute: root, underTests: false }];
  const conftestFiles: string[] = [];
  let hasTests = false;
  let visitedDirectories = 0;
  const directoryLimit = 20_000;
  while (queue.length > 0 && visitedDirectories < directoryLimit) {
    const current = queue.shift()!;
    visitedDirectories += 1;
    let entries: import("node:fs").Dirent[];
    try { entries = await fs.readdir(current.absolute, { withFileTypes: true }); } catch { continue; }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(current.absolute, entry.name);
      if (entry.isDirectory()) {
        if (!FALLBACK_IGNORED_DIRS.has(entry.name)) {
          queue.push({ absolute, underTests: current.underTests || entry.name.toLowerCase() === "tests" });
        }
        continue;
      }
      if (!entry.isFile()) continue;
      const relative = path.relative(root, absolute).replace(/\\/g, "/");
      if (entry.name === "conftest.py") conftestFiles.push(relative);
      if (/^test_.+\.py$/i.test(entry.name) && (current.absolute === root || current.underTests)) hasTests = true;
    }
  }
  return { hasTests, conftestFiles: conftestFiles.sort(), truncated: queue.length > 0 };
}

async function pythonDistributionAvailable(executable: "python" | "python3", distribution: string, runtime: "native" | "wsl"): Promise<boolean> {
  const script = `import importlib.metadata,sys\ntry:\n importlib.metadata.version(${JSON.stringify(distribution)})\nexcept importlib.metadata.PackageNotFoundError:\n sys.exit(1)`;
  try {
    if (runtime === "wsl" && process.platform === "win32") {
      await execFileAsync("wsl.exe", [executable, "-c", script], { windowsHide: true, timeout: 5_000 });
    } else {
      await execFileAsync(executable, ["-c", script], { windowsHide: true, timeout: 5_000 });
    }
    return true;
  } catch {
    return false;
  }
}

async function wslAvailable(): Promise<boolean> {
  if (process.platform !== "win32") return false;
  try {
    await execFileAsync("wsl.exe", ["--status"], { windowsHide: true, timeout: 5000 });
    return true;
  } catch { return false; }
}

export async function inspectProjectProfile(input: {
  workspaceDir: string;
  requestedRuntime?: CodeRuntime;
  posixRequired?: boolean;
  probe?: ProjectEnvironmentProbe;
}): Promise<ProjectProfile> {
  const root = path.resolve(input.workspaceDir);
  const probe = input.probe;
  const hasCommand = (command: string, runtime: "native" | "wsl") =>
    probe?.commandExists ? Promise.resolve(probe.commandExists(command, runtime)).then(Boolean) : commandExists(command, runtime);
  const hasPythonModule = (
    executable: "python" | "python3",
    moduleName: string,
    runtime: "native" | "wsl",
    cwd?: string,
  ) => probe?.pythonModuleAvailable
    ? Promise.resolve(probe.pythonModuleAvailable(executable, moduleName, runtime, cwd)).then(Boolean)
    : pythonModuleAvailable(executable, moduleName, runtime, cwd);
  const hasPythonDistribution = (
    executable: "python" | "python3",
    distribution: string,
    runtime: "native" | "wsl",
  ) => probe?.pythonDistributionAvailable
    ? Promise.resolve(probe.pythonDistributionAvailable(executable, distribution, runtime)).then(Boolean)
    : pythonDistributionAvailable(executable, distribution, runtime);
  const pythonInvocation = probe?.pythonInvocation && path.isAbsolute(probe.pythonInvocation.executable)
    ? probe.pythonInvocation
    : undefined;
  const identity = await resolveProjectProfileIdentity(root);
  const manifests: string[] = [];
  const lockfiles: string[] = [];
  const ecosystems: string[] = [];
  const testCommands: VerificationCommand[] = [];
  const blockers: string[] = [];
  let nodeScripts: Record<string, string> = {};

  const packageJson = await exists(root, "package.json");
  if (packageJson) {
    ecosystems.push("node");
    manifests.push("package.json");
    for (const name of ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"]) if (await exists(root, name)) lockfiles.push(name);
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8")) as { scripts?: Record<string, string> };
      nodeScripts = pkg.scripts ?? {};
    } catch { blockers.push("package.json is not valid JSON"); }
  }

  for (const name of ["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "tox.ini", "noxfile.py"]) {
    if (await exists(root, name)) manifests.push(name);
  }
  const pythonProject = manifests.some((name) => ["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt"].includes(name));
  if (pythonProject) {
    ecosystems.push("python");
    for (const name of ["uv.lock", "poetry.lock", "Pipfile.lock"]) if (await exists(root, name)) lockfiles.push(name);
  }

  // Runtime selection must precede runtime-specific wrapper and argv planning.
  // A tox.ini or Makefile alone is not evidence that Windows must cross into WSL.
  const posixRequired = input.posixRequired ?? false;
  const hasWsl = await wslAvailable();
  const runtime = resolveCodeRuntime({ requested: input.requestedRuntime ?? "auto", platform: process.platform, posixRequired, wslAvailable: hasWsl });

  if (await exists(root, "Cargo.toml")) {
    ecosystems.push("rust"); manifests.push("Cargo.toml");
    if (await exists(root, "Cargo.lock")) lockfiles.push("Cargo.lock");
    testCommands.push({ id: "project:rust:test", stage: "targeted", command: "cargo test", reason: "Cargo project" });
  }
  if (await exists(root, "go.mod")) {
    ecosystems.push("go"); manifests.push("go.mod");
    if (await exists(root, "go.sum")) lockfiles.push("go.sum");
    testCommands.push({ id: "project:go:test", stage: "targeted", command: "go test ./...", reason: "Go module" });
  }
  for (const name of ["pom.xml", "build.gradle", "build.gradle.kts"]) {
    if (await exists(root, name)) { ecosystems.push("java"); manifests.push(name); break; }
  }
  if (ecosystems.includes("java")) {
    const gradle = manifests.some((name) => name.startsWith("build.gradle"));
    const wrapper = process.platform === "win32" && runtime === "native" ? "gradlew.bat" : "gradlew";
    const wrapperCommand = runtime === "wsl" || process.platform !== "win32" ? "./gradlew" : ".\\gradlew.bat";
    testCommands.push({ id: gradle ? "project:java:gradle-test" : "project:java:maven-test", stage: "targeted", command: gradle ? (await exists(root, wrapper) ? `${wrapperCommand} test` : "gradle test") : "mvn test", reason: "Java build manifest" });
  }

  if (ecosystems.includes("node")) {
    const packageManager = lockfiles.includes("pnpm-lock.yaml")
      ? "pnpm"
      : lockfiles.includes("yarn.lock") ? "yarn"
        : lockfiles.some((name) => name === "bun.lock" || name === "bun.lockb") ? "bun" : "npm";
    if (await hasCommand(packageManager, runtime)) {
      const packageManagerExecutable = process.platform === "win32" && runtime === "native" ? `${packageManager}.cmd` : packageManager;
      if (nodeScripts.test) testCommands.push({ id: "project:node:test", stage: "targeted", command: `${packageManager} test`, executable: packageManagerExecutable, args: ["test"], reason: `package.json test script via ${packageManager}` });
      if (nodeScripts.build) testCommands.push({ id: "project:node:build", stage: "affected", command: `${packageManager} run build`, executable: packageManagerExecutable, args: ["run", "build"], reason: `package.json build script via ${packageManager}` });
    } else {
      blockers.push(`${packageManager} executable is unavailable in ${runtime}`);
    }
  }
  const pythonExecutable = pythonProject
    ? selectPythonExecutable({
        pythonAvailable: await hasCommand("python", runtime),
        python3Available: await hasCommand("python3", runtime),
      })
    : null;
  const pythonTestLayout = pythonProject
    ? await scanPythonTestLayout(root)
    : { hasTests: false, conftestFiles: [] as string[], truncated: false };
  if (pythonExecutable && await exists(root, "pyproject.toml")) {
    try {
      const requirements = extractPythonBuildRequirements(await fs.readFile(path.join(root, "pyproject.toml"), "utf8"));
      const missing: string[] = [];
      for (const requirement of requirements) {
        if (!await hasPythonDistribution(pythonExecutable, requirement, runtime)) missing.push(requirement);
      }
      if (missing.length > 0) blockers.push(`Python build requirements unavailable in ${runtime}: ${missing.join(", ")}`);
    } catch {
      blockers.push("pyproject.toml build-system requirements could not be inspected");
    }
  }
  const hasPythonTests = pythonProject && (
    await exists(root, "pytest.ini")
    || await exists(root, "tox.ini")
    || await exists(root, "pyproject.toml")
    || pythonTestLayout.hasTests
  );
  if (pythonTestLayout.truncated) {
    blockers.push("Python test discovery exceeded the safe directory limit; configure an explicit verifier");
  }
  if (hasPythonTests && !pythonTestLayout.truncated) {
    const missingBootstrapModules: string[] = [];
    if (pythonExecutable) {
      for (const moduleName of await findPythonTestBootstrapModules(root, pythonTestLayout.conftestFiles)) {
        if (!await hasPythonModule(pythonExecutable, moduleName, runtime, root)) missingBootstrapModules.push(moduleName);
      }
    }
    if (missingBootstrapModules.length > 0) {
      blockers.push(`Python test bootstrap modules unavailable in ${runtime}: ${missingBootstrapModules.join(", ")}`);
    } else if (pythonExecutable && await hasPythonModule(pythonExecutable, "pytest", runtime, root)) {
      testCommands.push({
        id: "project:python:pytest",
        stage: "targeted",
        command: `${pythonExecutable} -m pytest`,
        executable: pythonInvocation?.executable ?? pythonExecutable,
        args: [...(pythonInvocation?.argsPrefix ?? []), "-m", "pytest"],
        reason: "Python test configuration or discovered test layout",
      });
    } else if (pythonExecutable) {
      blockers.push(`pytest module is unavailable in ${runtime}`);
    }
  }
  if (input.requestedRuntime === "wsl" && process.platform === "win32" && !hasWsl) blockers.push("WSL was requested but is unavailable");
  if (ecosystems.includes("node") && !await hasCommand("node", runtime)) blockers.push(`node executable is unavailable in ${runtime}`);
  if (ecosystems.includes("python") && !pythonExecutable) blockers.push(`Python executable is unavailable in ${runtime}`);
  if (ecosystems.includes("rust") && !await hasCommand("cargo", runtime)) blockers.push(`cargo executable is unavailable in ${runtime}`);
  if (ecosystems.includes("go") && !await hasCommand("go", runtime)) blockers.push(`go executable is unavailable in ${runtime}`);
  if (ecosystems.includes("java")) {
    const gradle = manifests.some((name) => name.startsWith("build.gradle"));
    const localWrapper = await exists(root, process.platform === "win32" && runtime === "native" ? "gradlew.bat" : "gradlew");
    if (!localWrapper && !await hasCommand(gradle ? "gradle" : "mvn", runtime)) blockers.push(`${gradle ? "gradle" : "mvn"} executable is unavailable in ${runtime}`);
  }
  return {
    revision: identity.revision,
    dirtyFingerprint: identity.dirtyFingerprint,
    parserVersion: PROJECT_PROFILE_PARSER_VERSION,
    ecosystems: [...new Set(ecosystems)].sort(),
    manifests: [...new Set(manifests)].sort(),
    lockfiles: [...new Set(lockfiles)].sort(),
    testCommands,
    runtime,
    environmentStatus: blockers.length === 0 ? "ready" : ecosystems.length === 0 ? "unsupported" : "degraded",
    blockers,
  };
}
