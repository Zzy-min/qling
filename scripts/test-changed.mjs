#!/usr/bin/env node
/**
 * Typecheck, then run unit tests that reference changed src modules.
 *
 * Changed set: `git diff --name-only HEAD` plus untracked files.
 * src/foo/bar.ts matches a test that mentions foo/bar.js, foo/bar.ts, or foo/bar.mjs.
 * A changed tests/**\/*.test.mjs file is run directly.
 * With no matches, only `tsc --noEmit` runs.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc");

function gitLines(args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (error) {
    const stderr = error && error.stderr ? String(error.stderr) : String(error);
    console.error(stderr.trim());
    process.exit(1);
  }
}

function walkTests(dir, acc = []) {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return acc;
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) walkTests(abs, acc);
    else if (name.endsWith(".test.mjs")) acc.push(abs);
  }
  return acc;
}

function needlesFor(rel) {
  const norm = rel.replace(/\\/g, "/");
  if (!norm.startsWith("src/") || !/\.tsx?$/.test(norm)) return [];
  const noExt = norm.slice("src/".length).replace(/\.tsx?$/, "");
  return [`${noExt}.js`, `${noExt}.ts`, `${noExt}.mjs`];
}

function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const changed = [
  ...gitLines(["diff", "--name-only", "HEAD"]),
  ...gitLines(["ls-files", "--others", "--exclude-standard"]),
];
const testFiles = walkTests(path.join(root, "tests"));
const matched = new Set();

for (const rel of changed) {
  const norm = rel.replace(/\\/g, "/");
  if (/^tests\/.*\.test\.mjs$/.test(norm)) {
    matched.add(path.join(root, norm));
  }
  const needles = needlesFor(norm);
  if (needles.length === 0) continue;
  for (const file of testFiles) {
    const text = readFileSync(file, "utf8");
    if (needles.some((needle) => text.includes(needle))) matched.add(file);
  }
}

if (matched.size === 0) {
  console.log("test:changed: no matched tests; typecheck only");
  run([tsc, "--noEmit"]);
  process.exit(0);
}

console.log(`test:changed: tsc, then ${matched.size} test file(s)`);
for (const file of matched) console.log(`  ${path.relative(root, file)}`);
run([tsc]);

const isolate = path.join(root, "tests", "setup", "isolate.mjs");
const list = [...matched];
const unitSep = `${path.sep}unit${path.sep}`;
const unit = list.filter((file) => file.includes(unitSep));
const other = list.filter((file) => !file.includes(unitSep));
const batchSize = 40;

function runBatches(files, extraArgs) {
  for (let i = 0; i < files.length; i += batchSize) {
    const chunk = files.slice(i, i + batchSize);
    run([...extraArgs, "--test", ...chunk]);
  }
}

// Unit tests use the same isolation guard as `npm test`. Smoke tests keep the
// repo cwd; they spawn the CLI and are not part of that guard.
runBatches(unit, [
  "--experimental-test-module-mocks",
  "--import",
  pathToFileURL(isolate).href,
]);
runBatches(other, []);
