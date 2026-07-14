#!/usr/bin/env node
/**
 * Build a Windows portable zip that embeds a Node.js runtime (no system Node required).
 * Usage: node scripts/build-portable-win.mjs [--skip-node]
 *
 * Output: dist-portable/qling-win-x64.zip
 * Layout:
 *   qling-win-x64/
 *     runtime/node.exe   # bundled Node (same major as build host by default)
 *     package/           # npm pack contents
 *     qling.exe          # WinGet portable entry (Framework csc launcher)
 *     qling.cmd          # Scoop / shell-friendly launcher
 *     README.txt
 */
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  rm,
  readFile,
  writeFile,
  copyFile,
  access,
} from "node:fs/promises";
import { createWriteStream, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { get } from "node:https";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT_DIR = join(ROOT, "dist-portable");
const STAGE = join(OUT_DIR, "qling-win-x64");
const ZIP_PATH = join(OUT_DIR, "qling-win-x64.zip");
const skipNode = process.argv.includes("--skip-node");

const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
const version = pkg.version;
const nodeVersion = process.version; // e.g. v22.22.1
const nodeDistName = `node-${nodeVersion}-win-x64`;
const nodeZipUrl = `https://nodejs.org/dist/${nodeVersion}/${nodeDistName}.zip`;

console.log(`[portable] building qling ${version} for win-x64…`);
console.log(`[portable] host node ${nodeVersion} ${process.arch}`);

await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(STAGE, { recursive: true });

// 1) npm pack current tree
const pack = spawnSync(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["pack", "--pack-destination", OUT_DIR],
  { cwd: ROOT, encoding: "utf8", shell: true }
);
if (pack.status !== 0) {
  console.error(pack.stdout, pack.stderr);
  process.exit(1);
}
const tgzName = (pack.stdout || "")
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
  .pop();
if (!tgzName) {
  console.error("npm pack produced no tarball name");
  process.exit(1);
}
const tgzPath = join(OUT_DIR, tgzName);
console.log(`[portable] packed ${tgzName}`);

try {
  execFileSync("tar", ["-xzf", tgzPath, "-C", STAGE], { stdio: "inherit" });
} catch (err) {
  console.error("tar extract failed:", err instanceof Error ? err.message : err);
  process.exit(1);
}

// npm pack intentionally excludes node_modules. Install only runtime dependencies
// into the staged package, then rebuild the native dependency with lifecycle
// scripts enabled only for that dependency.
const stagedPackage = join(STAGE, "package");
await copyFile(join(ROOT, "package-lock.json"), join(stagedPackage, "package-lock.json"));
runChecked(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
  stagedPackage,
  "install staged production dependencies"
);
runChecked(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["rebuild", "better-sqlite3"],
  stagedPackage,
  "rebuild staged better-sqlite3"
);

// 2) Bundle Node runtime
const runtimeDir = join(STAGE, "runtime");
await mkdir(runtimeDir, { recursive: true });
let bundledNode = false;
let nodeNote = "System Node.js >= 18 on PATH";

if (!skipNode && process.platform === "win32") {
  const cacheDir = join(OUT_DIR, ".node-cache");
  await mkdir(cacheDir, { recursive: true });
  const nodeZipPath = join(cacheDir, `${nodeDistName}.zip`);
  if (!existsSync(nodeZipPath)) {
    console.log(`[portable] downloading ${nodeZipUrl}`);
    await downloadFile(nodeZipUrl, nodeZipPath);
  } else {
    console.log(`[portable] using cached ${nodeZipPath}`);
  }
  const extractDir = join(cacheDir, nodeDistName);
  await rm(extractDir, { recursive: true, force: true });
  execFileSync("tar", ["-xf", nodeZipPath, "-C", cacheDir], { stdio: "inherit" });
  const nodeExeSrc = join(extractDir, "node.exe");
  await access(nodeExeSrc);
  await copyFile(nodeExeSrc, join(runtimeDir, "node.exe"));
  // LICENSE if present
  const license = join(extractDir, "LICENSE");
  if (existsSync(license)) {
    await copyFile(license, join(runtimeDir, "NODE-LICENSE"));
  }
  bundledNode = true;
  nodeNote = `Bundled Node ${nodeVersion} (runtime\\node.exe)`;
  console.log(`[portable] bundled node.exe from ${nodeDistName}`);
} else if (!skipNode) {
  console.warn("[portable] non-Windows host: skip embedding node.exe (use --skip-node to silence)");
}

const launcher = `@echo off
setlocal
set "ROOT=%~dp0"
set "NODE_EXE="
if exist "%ROOT%runtime\\node.exe" set "NODE_EXE=%ROOT%runtime\\node.exe"
if not defined NODE_EXE (
  where node >nul 2>nul && set "NODE_EXE=node"
)
if not defined NODE_EXE (
  echo [qling] No bundled runtime and no system Node on PATH.
  echo [qling] Re-download the portable zip or install Node.js ^>= 18.
  exit /b 1
)
"%NODE_EXE%" "%ROOT%package\\dist\\index.js" %*
`;
await writeFile(join(STAGE, "qling.cmd"), launcher, "utf8");

// Native .exe launcher for WinGet portable (scripted .cmd/.bat not allowed)
const launcherCs = join(ROOT, "packaging", "win-launcher", "qling-launcher.cs");
const launcherExe = join(STAGE, "qling.exe");
if (!existsSync(launcherCs)) {
  console.error(`[portable] missing launcher source: ${launcherCs}`);
  process.exit(1);
}
const cscCandidates = [
  process.env.QLING_CSC,
  join(
    process.env.WINDIR || "C:\\Windows",
    "Microsoft.NET",
    "Framework64",
    "v4.0.30319",
    "csc.exe"
  ),
  join(
    process.env.WINDIR || "C:\\Windows",
    "Microsoft.NET",
    "Framework",
    "v4.0.30319",
    "csc.exe"
  ),
].filter(Boolean);
const csc = cscCandidates.find((p) => existsSync(p));
if (!csc) {
  console.error(
    "[portable] csc.exe not found (need .NET Framework 4.x). Set QLING_CSC to override."
  );
  process.exit(1);
}
const cscResult = spawnSync(
  csc,
  [
    "/nologo",
    "/target:exe",
    "/platform:anycpu",
    "/optimize+",
    `/out:${launcherExe}`,
    launcherCs,
  ],
  { encoding: "utf8" }
);
if (cscResult.status !== 0 || !existsSync(launcherExe)) {
  console.error("[portable] csc failed:", cscResult.stdout, cscResult.stderr);
  process.exit(1);
}
console.log(`[portable] compiled qling.exe via ${csc}`);

runChecked(launcherExe, ["--version"], STAGE, "verify portable launcher version");
runChecked(launcherExe, ["doctor"], STAGE, "verify portable launcher doctor");

const readme = `Qling ${version} — Windows portable layout
========================================

${bundledNode ? "This build embeds a Node.js runtime — no system Node install required." : "This build expects system Node.js >= 18 on PATH."}

Runtime:
  ${nodeNote}

Run:
  .\\qling.exe --version
  .\\qling.cmd --version
  .\\qling.exe doctor
  .\\qling.exe setup

Notes:
  - qling.exe is the WinGet portable entry point (native launcher).
  - qling.cmd remains for Scoop and interactive shells.
  - better-sqlite3 native binary is compiled for the Node ABI used at pack time.
  - Prefer matching the bundled Node major version if you replace runtime\\node.exe.

npm alternative:
  npm install -g @qlingzzy/qling@${version} --registry https://registry.npmjs.org/

Source: https://github.com/Zzy-min/qling
`;
await writeFile(join(STAGE, "README.txt"), readme, "utf8");

await rm(ZIP_PATH, { force: true });
execFileSync("tar", ["-a", "-cf", ZIP_PATH, "-C", OUT_DIR, "qling-win-x64"], {
  stdio: "inherit",
});

const buf = await readFile(ZIP_PATH);
const sha256 = createHash("sha256").update(buf).digest("hex");
const meta = {
  version,
  zip: "qling-win-x64.zip",
  path: ZIP_PATH,
  size: buf.length,
  sha256,
  bundledNode,
  nodeVersion: bundledNode ? nodeVersion : null,
  createdAt: new Date().toISOString(),
};
await writeFile(join(OUT_DIR, "portable-meta.json"), JSON.stringify(meta, null, 2) + "\n");

console.log(`[portable] wrote ${ZIP_PATH}`);
console.log(`[portable] size=${buf.length} sha256=${sha256}`);
console.log(`[portable] bundledNode=${bundledNode}`);
console.log(`[portable] meta: dist-portable/portable-meta.json`);

function runChecked(command, args, cwd, label) {
  console.log(`[portable] ${label}…`);
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32" && /\.cmd$/i.test(command),
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    if (result.error) console.error(`[portable] ${result.error.message}`);
    console.error(`[portable] ${label} failed with exit code ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

function downloadFile(url, dest) {
  return new Promise((resolvePromise, reject) => {
    const file = createWriteStream(dest);
    get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        downloadFile(res.headers.location, dest).then(resolvePromise, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`download failed: HTTP ${res.statusCode}`));
        return;
      }
      pipeline(res, file).then(resolvePromise, reject);
    }).on("error", reject);
  });
}
