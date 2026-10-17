import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const script = path.join(repoRoot, "scripts", "check-invariants.mjs");

function run(root, args) {
  return spawnSync(process.execPath, [script, "--root", root, ...args], {
    encoding: "utf8",
    cwd: repoRoot,
  });
}

function writeSrc(root, name, body) {
  const file = path.join(root, "src", name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body, "utf8");
}

test("check-invariants: a new violation fails strict mode", () => {
  const root = mkdtempSync(path.join(tmpdir(), "qling-inv-"));
  try {
    writeSrc(root, "leak.ts", 'const key = process.env.DEEPSEEK_API_KEY ?? "";\n');
    const baseline = path.join(root, "scripts", "invariants-baseline.json");
    mkdirSync(path.dirname(baseline), { recursive: true });
    writeFileSync(baseline, JSON.stringify({ version: 1, rules: {} }), "utf8");
    const result = run(root, ["--strict", "--baseline", baseline]);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /INCREASE provider-key-fallback/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("check-invariants: matching the baseline passes", () => {
  const root = mkdtempSync(path.join(tmpdir(), "qling-inv-"));
  try {
    writeSrc(root, "leak.ts", 'const key = process.env.OPENAI_API_KEY ?? "";\n');
    const baseline = path.join(root, "empty-baseline.json");
    const written = run(root, ["--write-baseline", "--baseline", baseline]);
    assert.equal(written.status, 0, written.stdout + written.stderr);
    const result = run(root, ["--strict", "--baseline", baseline]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /invariants strict: ok/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("check-invariants: dropping below the baseline passes with a shrink hint", () => {
  const root = mkdtempSync(path.join(tmpdir(), "qling-inv-"));
  try {
    writeSrc(root, "clean.ts", "export const value = 1;\n");
    const baseline = path.join(root, "high-baseline.json");
    writeFileSync(
      baseline,
      JSON.stringify({
        version: 1,
        rules: {
          "provider-key-fallback": {
            description: "provider-key fallback outside resolve-llm",
            pattern: "(DEEPSEEK|OPENAI)_API_KEY",
            files: { "src/leak.ts": 2 },
          },
        },
      }),
      "utf8",
    );
    const result = run(root, ["--strict", "--baseline", baseline]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /DECREASE provider-key-fallback src\/leak\.ts/);
    assert.match(result.stdout, /lint:invariants:write-baseline/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
