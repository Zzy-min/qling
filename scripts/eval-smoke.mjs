#!/usr/bin/env node
/**
 * 本地 smoke 评测：不依赖外部 LLM / API key
 * Usage: node scripts/eval-smoke.mjs [--json]
 */
import { runEvalSuite, formatEvalReport, evalReportToJson } from "../dist/eval/runner.js";

const asJson = process.argv.includes("--json");

const report = await runEvalSuite();
if (asJson) {
  process.stdout.write(evalReportToJson(report) + "\n");
} else {
  process.stdout.write(formatEvalReport(report).join("\n") + "\n");
}

process.exit(report.fail === 0 ? 0 : 1);
