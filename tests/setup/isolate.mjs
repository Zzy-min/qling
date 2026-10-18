/**
 * Global node --test isolation, loaded with `node --import ./tests/setup/isolate.mjs`.
 *
 * Per test-file process (the test runner forks one process per file):
 *   - chdir into a fresh temp directory
 *   - delete *_API_KEY and QLING_* from the environment
 *   - on exit, fail if git status shows a new top-level path in the repo root
 *
 * HOME and USERPROFILE are intentionally left alone. Node caches os.homedir()
 * at startup, and several modules capture that path at import, so rewriting
 * the variables would not isolate home-dir reads. Tests that load user rule
 * files must pass an explicit homeDir/stateDir fixture instead.
 *
 * Pre-existing porcelain entries do not count. The Node test runner does not
 * need any QLING_* or *_API_KEY variable, so the allow-list is empty.
 *
 * Importing this module does not install the guard. Only `--import` of this
 * file does, so tests can call `installTestIsolate(root)` against a fixture.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);

/** Variables the test runner itself needs. None of the scrubbed names qualify. */
export const ENV_ALLOW = new Set();

export function scrubEnv(env = process.env) {
  for (const key of Object.keys(env)) {
    if (ENV_ALLOW.has(key)) continue;
    if (key.startsWith("QLING_") || key.endsWith("_API_KEY")) {
      delete env[key];
    }
  }
}

function sameFile(spec) {
  if (!spec) return false;
  try {
    const candidate = spec.startsWith("file:") ? fileURLToPath(spec) : spec;
    const resolved = path.resolve(candidate);
    return path.normalize(resolved).toLowerCase() === path.normalize(SELF).toLowerCase();
  } catch {
    return false;
  }
}

function isThisPreload() {
  const args = process.execArgv;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--import" && sameFile(args[i + 1])) return true;
    if (arg.startsWith("--import=") && sameFile(arg.slice("--import=".length))) return true;
  }
  return false;
}

function porcelain(root) {
  try {
    const out = execFileSync(
      "git",
      ["-C", root, "status", "--porcelain", "--untracked-files=normal"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return out.split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

/** Top-level repo path (file or directory), or null when the entry is nested. */
export function topLevelPorcelainPath(line) {
  if (!line || line.length < 4) return null;
  let body = line.slice(3).trim();
  if (body.includes(" -> ")) body = body.split(" -> ").pop().trim();
  if (body.startsWith('"') && body.endsWith('"')) {
    body = body.slice(1, -1);
  }
  const norm = body.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (!norm || norm.includes("/")) return null;
  return norm;
}

/**
 * @param {string} repoRoot absolute repository root to watch
 */
export function installTestIsolate(repoRoot) {
  if (globalThis.__qlingIsolateInstalled) return;
  globalThis.__qlingIsolateInstalled = true;

  scrubEnv(process.env);
  const before = new Set(
    porcelain(repoRoot).map(topLevelPorcelainPath).filter(Boolean),
  );
  const dir = mkdtempSync(path.join(tmpdir(), "qling-test-"));
  process.chdir(dir);

  let checked = false;
  const check = () => {
    if (checked) return true;
    checked = true;
    const fresh = porcelain(repoRoot)
      .map(topLevelPorcelainPath)
      .filter((name) => name && !before.has(name));
    if (fresh.length === 0) return true;
    console.error("test isolation: new file(s) in repo root:");
    for (const name of fresh) console.error(`  ${name}`);
    process.exitCode = 1;
    return false;
  };

  const origExit = process.exit;
  process.exit = function patchedExit(code) {
    const ok = check();
    return origExit.call(process, ok ? code : 1);
  };
  process.on("beforeExit", () => {
    if (!check()) process.exit(1);
  });
}

if (isThisPreload()) {
  installTestIsolate(path.resolve(path.dirname(SELF), "../.."));
}
