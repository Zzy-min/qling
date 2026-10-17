import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const isolate = path.join(repoRoot, "tests", "setup", "isolate.mjs");

test("isolate scrubs QLING_* and *_API_KEY before user code", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      pathToFileURL(isolate).href,
      "-e",
      "process.exit((process.env.QLING_LEAK || process.env.FAKE_API_KEY) ? 2 : 0)",
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        QLING_LEAK: "1",
        FAKE_API_KEY: "secret",
      },
    },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("isolate fails when a test leaves a new file in the repo root", () => {
  const fixture = mkdtempSync(path.join(tmpdir(), "qling-iso-fixture-"));
  try {
    const init = spawnSync("git", ["init"], { cwd: fixture, encoding: "utf8" });
    assert.equal(init.status, 0, init.stderr);
    const preloadDir = path.join(fixture, "tests", "setup");
    mkdirSync(preloadDir, { recursive: true });
    const href = pathToFileURL(isolate).href;
    writeFileSync(
      path.join(preloadDir, "preload.mjs"),
      `import { installTestIsolate } from ${JSON.stringify(href)};
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
installTestIsolate(root);
`,
      "utf8",
    );
    writeFileSync(
      path.join(fixture, "leak.mjs"),
      `import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
writeFileSync(path.join(root, "stray-root.txt"), "leak");
`,
      "utf8",
    );
    const result = spawnSync(
      process.execPath,
      ["--import", pathToFileURL(path.join(preloadDir, "preload.mjs")).href, path.join(fixture, "leak.mjs")],
      { cwd: fixture, encoding: "utf8", env: { ...process.env } },
    );
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /stray-root\.txt/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
