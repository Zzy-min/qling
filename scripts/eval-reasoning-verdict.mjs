#!/usr/bin/env node
// Offline contract gate, not a real-model performance comparison.
import { pathToFileURL } from "node:url";
import { runReasoningBenchmark } from "../dist/eval/reasoning-benchmark.js";

export async function main(runBenchmark = runReasoningBenchmark) {
  const summary = await runBenchmark();
  console.log(JSON.stringify(summary, null, 2));
  const failed = summary.scenarios.filter((scenario) => !scenario.observedAcceptance);
  if (!summary.observedAcceptance || failed.length > 0) {
    console.error(`[eval:reasoning] FAILED offline acceptance: ${failed.map((scenario) => scenario.id).join(", ") || "scenario coverage"}`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
