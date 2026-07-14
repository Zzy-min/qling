import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("package.json has npm publish metadata for Phase 1.4", async () => {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

  assert.equal(pkg.name, "@qlingzzy/qling");
  assert.equal(pkg.version, "1.1.0");
  assert.equal(pkg.license, "MIT");
  assert.ok(pkg.bin?.qling === "dist/index.js" || pkg.bin?.qling === "./dist/index.js");
  assert.equal(pkg.publishConfig?.access, "public");
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

test("package lifecycle builds exactly once through prepare", async () => {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

  assert.equal(pkg.scripts?.prepare, "npm run build");
  assert.equal(
    pkg.scripts?.prepack,
    undefined,
    "prepack duplicates prepare and causes npm pack to clean/build dist twice"
  );
});

test("install docs and packaging drafts exist", async () => {
  const install = await readFile(join(root, "docs", "install.md"), "utf8");
  assert.match(install, /bootstrap/);
  assert.match(install, /Scoop|scoop/i);
  assert.match(install, /winget/i);
  assert.match(install, /validate:packaging/);

  const en = await readFile(join(root, "README.en.md"), "utf8");
  assert.match(en, /Local-first|local-first/i);
  assert.match(en, /qling setup/);
  assert.match(en, /eval:tasks/);
  assert.match(en, /fix-failing-test|example skills/i);

  const scoop = await readFile(join(root, "packaging", "scoop", "qling.json"), "utf8");
  assert.match(scoop, /DRAFT|draft|TODO/i);
  assert.match(scoop, /1\.1\.0/);

  const winget = await readFile(join(root, "packaging", "winget", "Zzy-min.qling.yaml"), "utf8");
  assert.match(winget, /PackageIdentifier:\s*Zzy-min\.qling/);
  assert.match(winget, /PackageVersion:\s*1\.1\.0/);
});

test("sprint4 ecosystem scripts and skills examples exist", async () => {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.equal(typeof pkg.scripts?.["eval:tasks"], "string");
  assert.equal(typeof pkg.scripts?.["validate:packaging"], "string");
  assert.match(pkg.scripts["ci:check"], /eval-tasks/);

  const examples = await readFile(join(root, "skills", "examples", "README.md"), "utf8");
  assert.match(examples, /fix-failing-test/);
  assert.match(examples, /add-function/);
  assert.match(examples, /pr-summary/);

  await readFile(join(root, "docs", "demo.md"), "utf8");
});
