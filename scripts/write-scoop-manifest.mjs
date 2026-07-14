#!/usr/bin/env node
/**
 * Write Scoop-compatible manifest (Extras style):
 * - 4-space indent
 * - plain SHA256 (no sha256: prefix)
 * - architecture.64bit for url/hash/extract_dir
 * - autoupdate.architecture.64bit
 *
 * Reads dist-portable/portable-meta.json when present.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const version = pkg.version;

let hash = "PLACEHOLDER";
const metaPath = join(root, "dist-portable", "portable-meta.json");
if (existsSync(metaPath)) {
  const meta = JSON.parse(await readFile(metaPath, "utf8"));
  hash = String(meta.sha256 || "").toLowerCase();
}

const manifest = {
  version,
  description: "Local-first Chinese AI Agent CLI workbench (Qling / 轻灵).",
  homepage: "https://github.com/Zzy-min/qling",
  license: "MIT",
  notes: [
    "Portable zip embeds a Node.js runtime (no system Node required).",
    "Set API keys as user environment variables (never commit secrets).",
    "After install: run qling doctor, then qling setup.",
  ],
  architecture: {
    "64bit": {
      url: `https://github.com/Zzy-min/qling/releases/download/v${version}/qling-win-x64.zip`,
      hash,
      extract_dir: "qling-win-x64",
    },
  },
  bin: "qling.cmd",
  post_install: [
    "Write-Host 'Run qling doctor, then qling setup.' -ForegroundColor Cyan",
  ],
  checkver: {
    github: "https://github.com/Zzy-min/qling",
  },
  autoupdate: {
    architecture: {
      "64bit": {
        url: "https://github.com/Zzy-min/qling/releases/download/v$version/qling-win-x64.zip",
      },
    },
  },
};

const json = JSON.stringify(manifest, null, 4) + "\n";
const targets = [
  join(root, "packaging", "scoop", "qling.json"),
  join(root, "packaging", "scoop-bucket", "qling.json"),
];
for (const t of targets) {
  await writeFile(t, json, "utf8");
  console.log("wrote", t);
}
console.log(`version=${version} hash=${hash.slice(0, 16)}…`);
