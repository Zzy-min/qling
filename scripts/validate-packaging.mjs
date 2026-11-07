#!/usr/bin/env node
/**
 * Validate source and published installer state separately; --release requires equality.
 * Usage: node scripts/validate-packaging.mjs [--release]
 */
import { readFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import YAML from "yaml";
import { createHash } from "node:crypto";

const defaultRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
export async function validatePackaging(root = defaultRoot, { release = false } = {}) {
const errors = [];

const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const sourceVersion = pkg.version;

const scoopRaw = await readFile(join(root, "packaging", "scoop", "qling.json"), "utf8");
const scoop = JSON.parse(scoopRaw);
const version = scoop.version;
const semver = /^\d+\.\d+\.\d+$/;
if (!semver.test(sourceVersion) || !semver.test(version)) errors.push("invalid source/published semantic version");
else {
  const a = sourceVersion.split('.').map(Number), b = version.split('.').map(Number);
  const comparison = a[0]-b[0] || a[1]-b[1] || a[2]-b[2];
  if (comparison < 0) errors.push(`source ${sourceVersion} is older than published installer ${version}`);
}
if (release && version !== sourceVersion) errors.push(`release pending: source ${sourceVersion} != published installer ${version}`);
const scoopUrl =
  scoop.architecture?.["64bit"]?.url || scoop.url || "";
const scoopHash =
  scoop.architecture?.["64bit"]?.hash || scoop.hash || "";
if (scoopUrl !== `https://github.com/Zzy-min/qling/releases/download/v${version}/qling-win-x64.zip`) {
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
if (!existsSync(multiInstaller)) errors.push("missing published multi-file winget installer");
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
  if ((b.architecture?.["64bit"]?.url || b.url) !== scoopUrl) errors.push("scoop-bucket url mismatch");
  const bHash = b.architecture?.["64bit"]?.hash || b.hash;
  if (bHash !== scoopHash) errors.push("scoop-bucket hash out of sync with scoop/qling.json");
} else errors.push("missing scoop-bucket manifest");

const checkWinget = (raw, label, installerRequired) => {
  const manifest = YAML.parse(raw);
  if (manifest.PackageVersion !== version || manifest.PackageIdentifier !== 'Zzy-min.qling') errors.push(`${label} identity/version mismatch`);
  if (installerRequired && !manifest.Installers?.length) errors.push(`${label} missing installers`);
  for (const installer of manifest.Installers ?? []) {
    if (installer.InstallerUrl !== scoopUrl) errors.push(`${label} URL differs from Scoop published artifact`);
    if (String(installer.InstallerSha256).toLowerCase() !== String(scoopHash).toLowerCase()) errors.push(`${label} hash differs from Scoop published artifact`);
  }
};
checkWinget(winget, 'winget singleton', true);
if (existsSync(multiInstaller)) {
  checkWinget(await readFile(multiInstaller, 'utf8'), 'winget installer', true);
  for (const name of ['Zzy-min.qling.yaml', 'Zzy-min.qling.locale.en-US.yaml']) {
    const file = join(dirname(multiInstaller), name);
    if (!existsSync(file)) errors.push(`missing ${name}`);
    else checkWinget(await readFile(file, 'utf8'), name, false);
  }
}
if (release) {
  const artifact = join(root, 'dist-portable', 'qling-win-x64.zip');
  try {
    const bytes = await readFile(artifact);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== String(scoopHash).toLowerCase()) errors.push('release artifact SHA-256 differs from installer manifests');
    try {
      const metadata = JSON.parse(await readFile(join(root, 'dist-portable', 'portable-meta.json'), 'utf8'));
      if (metadata.version !== sourceVersion || metadata.zip !== 'qling-win-x64.zip' ||
          metadata.size !== bytes.length || metadata.sha256 !== digest ||
          (metadata.path && resolve(metadata.path) !== resolve(artifact))) {
        errors.push('portable metadata does not match release artifact version/filename/size/SHA-256/path');
      }
    } catch { errors.push('missing or invalid portable metadata for release artifact'); }
  } catch { errors.push('missing release artifact dist-portable/qling-win-x64.zip'); }
}
return { errors, sourceVersion, publishedVersion: version, scoopUrl, scoopHash };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
const { errors, sourceVersion, publishedVersion: version, scoopUrl, scoopHash } = await validatePackaging(defaultRoot, {release: process.argv.includes('--release')});
if (errors.length) {
  console.error("validate-packaging FAILED:");
  for (const e of errors) console.error(" -", e);
  process.exit(1);
}

console.log(`validate-packaging OK (source ${sourceVersion}; published installer ${version}; mode ${process.argv.includes("--release") ? "release" : "source"})`);
console.log("  scoop:", scoopUrl);
console.log("  scoop.hash:", String(scoopHash).slice(0, 20) + "…");
console.log("  winget: Zzy-min.qling @", version);

}
