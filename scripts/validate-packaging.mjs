#!/usr/bin/env node
/**
 * Validate Scoop / winget manifests align with package.json version.
 * Usage: node scripts/validate-packaging.mjs
 */
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const version = pkg.version;

const scoopRaw = await readFile(join(root, "packaging", "scoop", "qling.json"), "utf8");
const scoop = JSON.parse(scoopRaw);
if (scoop.version !== version) {
  errors.push(`scoop version ${scoop.version} != package ${version}`);
}
const scoopUrl =
  scoop.architecture?.["64bit"]?.url || scoop.url || "";
const scoopHash =
  scoop.architecture?.["64bit"]?.hash || scoop.hash || "";
if (!String(scoopUrl).includes(version)) {
  errors.push(`scoop url does not pin ${version}: ${scoopUrl}`);
}
if (!scoop.architecture?.["64bit"]) {
  errors.push("scoop should nest url/hash under architecture.64bit (Extras style)");
}
if (!scoopHash || /TODO|REPLACE|PLACEHOLDER/i.test(String(scoopHash))) {
  errors.push("scoop hash still placeholder — run build:portable-win + sync-winget-sha");
} else if (!/^(sha256:)?[a-f0-9]{64}$/i.test(String(scoopHash))) {
  errors.push(`scoop hash looks invalid: ${scoopHash}`);
}
if (/sha256:/i.test(String(scoopHash))) {
  errors.push("scoop hash should be plain hex (no sha256: prefix) for Extras");
}
if (!String(scoop.bin || "").includes("qling")) {
  errors.push("scoop bin should expose qling");
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
if (/InstallerSha256:\s*(0{64}|PLACEHOLDER)/i.test(winget)) {
  errors.push("winget InstallerSha256 is still placeholder");
}

const multiInstaller = join(
  root,
  "packaging",
  "winget",
  "manifests",
  "Zzy-min",
  "qling",
  version,
  "Zzy-min.qling.installer.yaml"
);
if (existsSync(multiInstaller)) {
  const mi = await readFile(multiInstaller, "utf8");
  if (/InstallerSha256:\s*(0{64}|PLACEHOLDER)/i.test(mi)) {
    errors.push("multi-file winget installer sha still placeholder");
  }
  if (!mi.includes(`PackageVersion: ${version}`)) {
    errors.push("multi-file winget installer version mismatch");
  }
}

const bucket = join(root, "packaging", "scoop-bucket", "qling.json");
if (existsSync(bucket)) {
  const b = JSON.parse(await readFile(bucket, "utf8"));
  if (b.version !== version) errors.push("scoop-bucket version mismatch");
  const bHash = b.architecture?.["64bit"]?.hash || b.hash;
  if (bHash !== scoopHash) errors.push("scoop-bucket hash out of sync with scoop/qling.json");
}

if (errors.length) {
  console.error("validate-packaging FAILED:");
  for (const e of errors) console.error(" -", e);
  process.exit(1);
}

console.log(`validate-packaging OK (version ${version})`);
console.log("  scoop:", scoopUrl);
console.log("  scoop.hash:", String(scoopHash).slice(0, 20) + "…");
console.log("  winget: Zzy-min.qling @", version);
