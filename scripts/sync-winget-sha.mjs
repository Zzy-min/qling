#!/usr/bin/env node
/**
 * Fill winget InstallerSha256 from dist-portable/portable-meta.json
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const metaPath = join(root, "dist-portable", "portable-meta.json");
if (!existsSync(metaPath)) {
  console.error("missing dist-portable/portable-meta.json — run npm run build:portable-win first");
  process.exit(1);
}
const meta = JSON.parse(await readFile(metaPath, "utf8"));
const sha = String(meta.sha256 || "").toLowerCase();
if (!/^[a-f0-9]{64}$/.test(sha)) {
  console.error("invalid sha256 in portable-meta.json");
  process.exit(1);
}

const version = meta.version || JSON.parse(await readFile(join(root, "package.json"), "utf8")).version;
const targets = [
  join(root, "packaging", "winget", "Zzy-min.qling.yaml"),
  join(root, "packaging", "winget", "manifests", "Zzy-min", "qling", version, "Zzy-min.qling.installer.yaml"),
];

for (const file of targets) {
  if (!existsSync(file)) {
    console.warn("skip missing", file);
    continue;
  }
  let text = await readFile(file, "utf8");
  text = text.replace(/InstallerSha256:\s*[A-Za-z0-9_]+/g, `InstallerSha256: ${sha}`);
  text = text.replace(/PackageVersion:\s*[\d.]+/g, `PackageVersion: ${version}`);
  text = text.replace(/v[\d.]+\//g, `v${version}/`);
  await writeFile(file, text, "utf8");
  console.log("updated", file);
}

// Scoop: rewrite Extras-compatible 64bit manifest
const { spawnSync } = await import("node:child_process");
const scoopScript = join(root, "scripts", "write-scoop-manifest.mjs");
const r = spawnSync(process.execPath, [scoopScript], { cwd: root, encoding: "utf8" });
process.stdout.write(r.stdout || "");
process.stderr.write(r.stderr || "");
if (r.status !== 0) process.exit(r.status || 1);

// Multi-file winget for this version dir (create if missing)
const multiDir = join(root, "packaging", "winget", "manifests", "Zzy-min", "qling", version);
if (!existsSync(multiDir)) {
  console.warn("note: multi-file winget dir missing for", version, "- create under packaging/winget/manifests");
}

console.log(`sync-winget-sha OK version=${version} sha=${sha.slice(0, 16)}… bundledNode=${meta.bundledNode}`);
