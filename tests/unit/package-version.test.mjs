import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  formatCliVersion,
  formatDaemonVersion,
  getPackageVersion,
  resetPackageVersionCache,
} from "../../dist/package-version.js";
import { buildIntroSection } from "../../dist/pipeline/sections.js";

test("getPackageVersion matches package.json", async () => {
  resetPackageVersionCache();
  const pkg = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf-8"));
  assert.equal(getPackageVersion(), pkg.version);
  assert.equal(formatCliVersion("qling"), `qling/${pkg.version}`);
  assert.equal(formatDaemonVersion(), `${pkg.version}-daemon`);
});

test("system prompt intro section uses package version not hardcoded 0.5.0", async () => {
  resetPackageVersionCache();
  const pkg = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf-8"));
  const section = buildIntroSection("轻灵", getPackageVersion());
  assert.match(section.content, new RegExp(`v${pkg.version.replace(/\./g, "\\.")}`));
  assert.doesNotMatch(section.content, /v0\.5\.0/);
});
