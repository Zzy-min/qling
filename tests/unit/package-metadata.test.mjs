import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("package.json has npm publish metadata for Phase 1.4", async () => {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

  assert.equal(pkg.name, "qling");
  assert.equal(pkg.version, "1.0.0");
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.bin?.qling, "./dist/index.js");
  assert.ok(pkg.engines?.node);
  assert.match(String(pkg.engines.node), /18/);
  assert.ok(Array.isArray(pkg.keywords) && pkg.keywords.includes("agent"));
  assert.ok(pkg.keywords.includes("local-first"));
  assert.ok(pkg.repository?.url?.includes("qling"));
  assert.ok(pkg.homepage?.includes("qling"));
  assert.ok(pkg.bugs?.url?.includes("issues"));
  assert.ok(Array.isArray(pkg.files));
  assert.ok(pkg.files.includes("dist"));
  assert.ok(pkg.files.includes("README.md"));
  assert.ok(pkg.files.includes("README.en.md"));
  assert.ok(pkg.files.includes("LICENSE"));
});

test("install docs and packaging drafts exist", async () => {
  const install = await readFile(join(root, "docs", "install.md"), "utf8");
  assert.match(install, /bootstrap/);
  assert.match(install, /Scoop|scoop/i);
  assert.match(install, /winget/i);

  const en = await readFile(join(root, "README.en.md"), "utf8");
  assert.match(en, /Local-first|local-first/i);
  assert.match(en, /qling setup/);

  const scoop = await readFile(join(root, "packaging", "scoop", "qling.json"), "utf8");
  assert.match(scoop, /DRAFT|draft|TODO/i);

  const winget = await readFile(join(root, "packaging", "winget", "Zzy-min.qling.yaml"), "utf8");
  assert.match(winget, /PackageIdentifier:\s*Zzy-min\.qling/);
});
