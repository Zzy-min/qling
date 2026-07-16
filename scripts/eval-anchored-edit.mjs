#!/usr/bin/env node

import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPatch } from "../dist/tools/patch.js";
import { runPatchAnchored, runReadAnchored } from "../dist/tools/anchored-edit.js";

const SAFE_FIXTURES_PER_KIND = 4;
const MIN_IMPROVEMENT_POINTS = 15;

function baseLines(id) {
  return [
    `header-${id}`,
    `context-a-${id}`,
    `context-b-${id}`,
    `TARGET_${id} = old`,
    `context-c-${id}`,
    `context-d-${id}`,
    `footer-${id}`,
  ];
}

function buildFixtures() {
  const fixtures = [];
  for (const kind of ["exact", "prefix_shift", "inner_context_insert", "normalized_whitespace"]) {
    for (let index = 0; index < SAFE_FIXTURES_PER_KIND; index++) {
      const id = `${kind}_${index}`;
      const original = baseLines(id);
      const mutated = [...original];
      if (kind === "prefix_shift") mutated.unshift(`external-prefix-${id}`);
      if (kind === "inner_context_insert") mutated.splice(2, 0, `external-inner-${id}`);
      if (kind === "normalized_whitespace") {
        mutated[3] = `  TARGET_${id}   =   old  `;
      }
      fixtures.push({ id, kind, original, mutated, safe: true });
    }
  }

  for (let index = 0; index < 2; index++) {
    const id = `target_changed_${index}`;
    const original = baseLines(id);
    const mutated = [...original];
    mutated[3] = `TARGET_${id} = externally_changed`;
    fixtures.push({ id, kind: "target_changed", original, mutated, safe: false });
  }
  for (let index = 0; index < 2; index++) {
    const id = `ambiguous_duplicate_${index}`;
    const original = baseLines(id);
    fixtures.push({
      id,
      kind: "ambiguous_duplicate",
      original,
      // Shift the original location so direct line validation fails, then place
      // two identical anchors inside the ±15-line recovery window.
      mutated: [`external-a-${id}`, `external-b-${id}`, ...original, `separator-${id}`, ...original],
      safe: false,
    });
  }
  return fixtures;
}

function expectedContent(fixture) {
  if (!fixture.safe) return null;
  const lines = [...fixture.mutated];
  const targetIndex = lines.findIndex((line) => line.includes(`TARGET_${fixture.id}`));
  if (targetIndex < 0) throw new Error(`fixture ${fixture.id} lost its target`);
  lines[targetIndex] = `TARGET_${fixture.id} = new`;
  return lines.join("\n");
}

function saveEnv(keys) {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function prepareRead(root, fixture) {
  const sourceDir = join(root, fixture.id, "source");
  await mkdir(sourceDir, { recursive: true });
  const sourceFile = join(sourceDir, "demo.txt");
  await writeFile(sourceFile, fixture.original.join("\n"), "utf8");
  const read = await runReadAnchored({ path: sourceFile });
  if (read.is_error) throw new Error(`read_anchored failed for ${fixture.id}: ${read.output}`);
  const anchorLine = String(read.output)
    .split("\n")
    .find((line) => line.includes(`|TARGET_${fixture.id} = old`));
  if (!anchorLine) throw new Error(`anchor missing for ${fixture.id}`);
  return {
    anchor: anchorLine.split("|")[0],
    revision: String(read.meta?.revision ?? ""),
  };
}

async function runEngine(root, fixture, engine, anchorRead) {
  const engineDir = join(root, fixture.id, engine);
  await mkdir(engineDir, { recursive: true });
  const file = join(engineDir, "demo.txt");
  const before = fixture.mutated.join("\n");
  await writeFile(file, before, "utf8");

  let result;
  if (engine === "patch") {
    const originalBlock = fixture.original.slice(1, 6);
    const replacementBlock = [...originalBlock];
    replacementBlock[2] = `TARGET_${fixture.id} = new`;
    result = await runPatch({
      path: file,
      chunks: [{ search: originalBlock.join("\n"), replace: replacementBlock.join("\n") }],
    });
  } else {
    result = await runPatchAnchored({
      path: file,
      file_revision: anchorRead.revision,
      edits: [{ anchor: anchorRead.anchor, replace: `TARGET_${fixture.id} = new` }],
    });
  }

  const after = await readFile(file, "utf8");
  const expected = expectedContent(fixture);
  const reportedSuccess = result.is_error !== true;
  const correct = expected === null
    ? !reportedSuccess && after === before
    : reportedSuccess && after === expected;
  const wrongWrite = expected === null
    ? after !== before
    : (reportedSuccess && after !== expected) || (!reportedSuccess && after !== before);
  return { correct, wrongWrite, reportedSuccess, error: result.error?.code ?? null };
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "qling-anchored-eval-"));
  const env = saveEnv([
    "QLING_WORKSPACE_DIR",
    "QLING_FILE_STATE_DIR",
    "QLING_FILE_CACHE_DIR",
    "QLING_SANDBOX_PROFILE",
  ]);
  process.env.QLING_WORKSPACE_DIR = root;
  process.env.QLING_FILE_STATE_DIR = join(root, ".state");
  process.env.QLING_FILE_CACHE_DIR = join(root, ".cache");
  process.env.QLING_SANDBOX_PROFILE = "workspace";

  try {
    const fixtures = buildFixtures();
    const results = [];
    for (const fixture of fixtures) {
      const anchorRead = await prepareRead(root, fixture);
      results.push({
        fixture,
        patch: await runEngine(root, fixture, "patch", anchorRead),
        anchored: await runEngine(root, fixture, "anchored", anchorRead),
      });
    }

    const safe = results.filter((item) => item.fixture.safe);
    const patchCorrect = safe.filter((item) => item.patch.correct).length;
    const anchoredCorrect = safe.filter((item) => item.anchored.correct).length;
    const patchRate = (patchCorrect / safe.length) * 100;
    const anchoredRate = (anchoredCorrect / safe.length) * 100;
    const improvementPoints = anchoredRate - patchRate;
    const anchoredWrongWrites = results.filter((item) => item.anchored.wrongWrite).length;
    const unsafeAccepted = results.filter(
      (item) => !item.fixture.safe && item.anchored.reportedSuccess
    ).length;
    const summary = {
      ok:
        improvementPoints >= MIN_IMPROVEMENT_POINTS
        && anchoredWrongWrites === 0
        && unsafeAccepted === 0,
      fixtures: results.length,
      safeFixtures: safe.length,
      patch: { correct: patchCorrect, successRate: patchRate },
      anchored: {
        correct: anchoredCorrect,
        successRate: anchoredRate,
        wrongWrites: anchoredWrongWrites,
        unsafeAccepted,
      },
      improvementPoints,
      requiredImprovementPoints: MIN_IMPROVEMENT_POINTS,
      byKind: Object.fromEntries(
        [...new Set(results.map((item) => item.fixture.kind))].map((kind) => {
          const matching = results.filter((item) => item.fixture.kind === kind);
          return [kind, {
            count: matching.length,
            patchCorrect: matching.filter((item) => item.patch.correct).length,
            anchoredCorrect: matching.filter((item) => item.anchored.correct).length,
          }];
        })
      ),
    };
    console.log(JSON.stringify(summary));
    if (!summary.ok) process.exitCode = 1;
  } finally {
    restoreEnv(env);
    await rm(root, { recursive: true, force: true });
  }
}

await main();
