import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  listSecretScanCandidatePaths,
  scanDotEnvContent,
  scanRuntimeDotEnvSecrets,
  SECRET_ENV_FILENAMES,
} from "../../dist/config.js";

test("SECRET_ENV_FILENAMES covers common variants", () => {
  assert.ok(SECRET_ENV_FILENAMES.includes(".env"));
  assert.ok(SECRET_ENV_FILENAMES.includes(".env.local"));
  assert.ok(SECRET_ENV_FILENAMES.includes(".env.production"));
});

test("listSecretScanCandidatePaths includes cwd env variants", () => {
  const paths = listSecretScanCandidatePaths("C:\\proj", "C:\\home\\.qling");
  assert.ok(paths.some((p) => p.replace(/\\/g, "/").endsWith("/.qling/.env")));
  assert.ok(paths.some((p) => p.replace(/\\/g, "/").endsWith("/proj/.env.local")));
});

test("scanDotEnvContent never includes values", () => {
  const hits = scanDotEnvContent("/tmp/.env", "OPENAI_API_KEY=sk-super-secret\nFOO=bar\n");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].varName, "OPENAI_API_KEY");
  assert.doesNotMatch(JSON.stringify(hits), /sk-super-secret/);
});

test("scanRuntimeDotEnvSecrets finds .env.local in temp cwd", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-scan-"));
  const prevCwd = process.cwd();
  try {
    await writeFile(join(dir, ".env.local"), "MY_API_KEY=sk-hidden-value\n", "utf8");
    process.chdir(dir);
    const hits = await scanRuntimeDotEnvSecrets(join(dir, ".qling-state"));
    assert.ok(hits.some((h) => h.varName === "MY_API_KEY"));
    assert.doesNotMatch(JSON.stringify(hits), /sk-hidden-value/);
  } finally {
    process.chdir(prevCwd);
    await rm(dir, { recursive: true, force: true });
  }
});
