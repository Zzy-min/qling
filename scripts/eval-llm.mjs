#!/usr/bin/env node
/**
 * 可选 LLM 评测：默认 skip，不进入 ci:check
 * Usage:
 *   QLING_EVAL_LLM=1 DEEPSEEK_API_KEY=... node scripts/eval-llm.mjs
 *   npm run eval:llm
 */
import {
  runEvalSuite,
  formatEvalReport,
  evalReportToJson,
} from "../dist/eval/runner.js";
import { buildEvalLlmTasks } from "../dist/eval/llm-tasks.js";

const asJson = process.argv.includes("--json");
const report = await runEvalSuite({ tasks: buildEvalLlmTasks() });

if (asJson) {
  process.stdout.write(evalReportToJson(report) + "\n");
} else {
  process.stdout.write(
    formatEvalReport(report, { title: "🧪 Qling eval:llm (optional)" }).join("\n") + "\n"
  );
}

// skip 全部视为成功；仅 fail 导致非 0
process.exit(report.fail === 0 ? 0 : 1);
