#!/usr/bin/env node
/**
 * Build a Windows portable zip for winget / manual install.
 * Usage: node scripts/build-portable-win.mjs
 *
 * Output: dist-portable/qling-win-x64.zip
 * Layout:
 *   qling-win-x64/
 *     package/          # npm pack contents
 *     qling.cmd         # launcher → node package/dist/index.js
 *     README.txt
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  rm,
  readFile,
  writeFile,
  copyFile,
  readdir,
  stat,
} from "node:fs/promises";
import { createWriteStream, existsSync, createReadStream } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT_DIR = join(ROOT, "dist-portable");
const STAGE = join(OUT_DIR, "qling-win-x64");
const ZIP_PATH = join(OUT_DIR, "qling-win-x64.zip");

const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
const version = pkg.version;

console.log(`[portable] building qling ${version} for win-x64…`);

await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(STAGE, { recursive: true });

// Prefer npm pack of current tree (matches publish)
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

// Extract with tar (Node 22+ / Windows 10+ tar)
const pkgDir = join(STAGE, "package");
await mkdir(pkgDir, { recursive: true });
try {
  execFileSync("tar", ["-xzf", tgzPath, "-C", STAGE], { stdio: "inherit" });
  // npm pack extracts to package/
} catch (err) {
  console.error("tar extract failed:", err instanceof Error ? err.message : err);
  process.exit(1);
}

const launcher = `@echo off
setlocal
set "ROOT=%~dp0"
set "NODE="
where node >nul 2>nul && set "NODE=node"
if not defined NODE (
  echo [qling] Node.js ^>= 18 is required on PATH.
  exit /b 1
)
"%NODE%" "%ROOT%package\\dist\\index.js" %*
`;
await writeFile(join(STAGE, "qling.cmd"), launcher, "utf8");

const readme = `Qling ${version} — Windows portable layout
========================================

Requirements:
  - Node.js >= 18 on PATH
  - Visual Studio Build Tools may be needed for better-sqlite3 rebuilds

Run:
  .\\qling.cmd --version
  .\\qling.cmd doctor
  .\\qling.cmd setup

Preferred install for most users:
  npm install -g @qlingzzy/qling@${version} --registry https://registry.npmjs.org/

Source: https://github.com/Zzy-min/qling
`;
await writeFile(join(STAGE, "README.txt"), readme, "utf8");

// Zip via tar (bsdtar on Windows supports zip)
await rm(ZIP_PATH, { force: true });
try {
  execFileSync(
    "tar",
    ["-a", "-cf", ZIP_PATH, "-C", OUT_DIR, "qling-win-x64"],
    { stdio: "inherit" }
  );
} catch (err) {
  console.error("zip failed:", err instanceof Error ? err.message : err);
  process.exit(1);
}

const buf = await readFile(ZIP_PATH);
const sha256 = createHash("sha256").update(buf).digest("hex");
const meta = {
  version,
  zip: "qling-win-x64.zip",
  path: ZIP_PATH,
  size: buf.length,
  sha256,
  createdAt: new Date().toISOString(),
};
await writeFile(join(OUT_DIR, "portable-meta.json"), JSON.stringify(meta, null, 2) + "\n");

console.log(`[portable] wrote ${ZIP_PATH}`);
console.log(`[portable] size=${buf.length} sha256=${sha256}`);
console.log(`[portable] meta: dist-portable/portable-meta.json`);
