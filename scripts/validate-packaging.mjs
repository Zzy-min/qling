#!/usr/bin/env node
/**
 * Validate Scoop / winget draft manifests align with package.json version.
 * Usage: node scripts/validate-packaging.mjs
 */
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const version = pkg.version;

const scoopRaw = await readFile(join(root, "packaging", "scoop", "qling.json"), "utf8");
const scoop = JSON.parse(scoopRaw);
if (scoop.version !== version) {
  errors.push(`scoop version ${scoop.version} != package ${version}`);
}
if (!String(scoop.url || "").includes(version)) {
  errors.push(`scoop url does not pin ${version}: ${scoop.url}`);
}
if (!Array.isArray(scoop.notes) || !scoop.notes.some((n) => /DRAFT|draft/i.test(n))) {
  errors.push("scoop notes should mark DRAFT status");
}
const hash = String(scoop.hash || "");
if (!hash || /TODO|REPLACE/i.test(hash)) {
  errors.push("scoop hash still placeholder — fill real SHA256 after npm publish");
} else if (!/^(sha256:)?[a-f0-9]{64}$/i.test(hash)) {
  errors.push(`scoop hash looks invalid: ${hash}`);
}

const winget = await readFile(
  join(root, "packaging", "winget", "Zzy-min.qling.yaml"),
  "utf8"
);
if (!winget.includes(`PackageVersion: ${version}`)) {
  errors.push(`winget PackageVersion missing ${version}`);
}
if (!winget.includes("PackageIdentifier: Zzy-min.qling")) {
  errors.push("winget PackageIdentifier missing");
}
if (!/DRAFT|not submitted/i.test(winget)) {
  errors.push("winget should remain marked as DRAFT");
}

if (errors.length) {
  console.error("validate-packaging FAILED:");
  for (const e of errors) console.error(" -", e);
  process.exit(1);
}

console.log(`validate-packaging OK (version ${version})`);
console.log("  scoop:", scoop.url);
console.log("  winget: Zzy-min.qling @", version);
console.log("  note: still drafts — not published to official catalogs");
