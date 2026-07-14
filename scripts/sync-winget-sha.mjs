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

// Scoop: prefer portable zip when available
const scoopPaths = [
  join(root, "packaging", "scoop", "qling.json"),
  join(root, "packaging", "scoop-bucket", "qling.json"),
];
for (const scoopPath of scoopPaths) {
  if (!existsSync(scoopPath)) continue;
  const j = JSON.parse(await readFile(scoopPath, "utf8"));
  j.version = version;
  j.url = `https://github.com/Zzy-min/qling/releases/download/v${version}/qling-win-x64.zip`;
  j.hash = `sha256:${sha}`;
  j.extract_dir = "qling-win-x64";
  j.bin = "qling.cmd";
  delete j.env_add_path;
  j.notes = [
    "Portable zip embeds Node.js runtime (no system Node required).",
    "Source: https://github.com/Zzy-min/qling",
    "API keys must be set as user environment variables (never commit secrets).",
  ];
  j.checkver = { github: "https://github.com/Zzy-min/qling" };
  j.autoupdate = {
    url: "https://github.com/Zzy-min/qling/releases/download/v$version/qling-win-x64.zip",
  };
  j.post_install = [
    "Write-Host 'qling installed. Run: qling doctor && qling setup' -ForegroundColor Cyan",
  ];
  // Scoop portable zip does not depend on system nodejs when runtime is embedded
  delete j.depends;
  await writeFile(scoopPath, JSON.stringify(j, null, 2) + "\n", "utf8");
  console.log("updated", scoopPath);
}

console.log(`sync-winget-sha OK version=${version} sha=${sha.slice(0, 16)}… bundledNode=${meta.bundledNode}`);
