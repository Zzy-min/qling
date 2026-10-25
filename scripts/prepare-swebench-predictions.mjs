#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error("Usage: node scripts/prepare-swebench-predictions.mjs <predictions.json> <predictions.jsonl>");
}

const predictions = JSON.parse(await readFile(resolve(inputPath), "utf8"));
if (!Array.isArray(predictions)) throw new Error("predictions input must be a JSON array");
for (const prediction of predictions) {
  if (!prediction || typeof prediction !== "object") throw new Error("prediction must be an object");
  for (const field of ["instance_id", "model_name_or_path", "model_patch"]) {
    if (typeof prediction[field] !== "string") throw new Error(`prediction.${field} must be a string`);
  }
}
await writeFile(
  resolve(outputPath),
  predictions.map((prediction) => JSON.stringify(prediction)).join("\n") + (predictions.length ? "\n" : ""),
  "utf8"
);
console.log(JSON.stringify({ converted: predictions.length, output: resolve(outputPath) }));
