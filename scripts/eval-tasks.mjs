#!/usr/bin/env node
/**
 * 本地 repo fixture 评测（不依赖外部 LLM / API key）
 * Usage: node scripts/eval-tasks.mjs [--json]
 */
import { runEvalSuite, formatEvalReport, evalReportToJson } from "../dist/eval/runner.js";
import { buildEvalRepoTasks } from "../dist/eval/repo-tasks.js";

const asJson = process.argv.includes("--json");

const report = await runEvalSuite({
  tasks: buildEvalRepoTasks(),
  evidence: {
    executor: "component",
    model: "none",
    verifier: "environment",
    claim: "Validates deterministic fixture mutation and verifier behavior.",
    limitations: [
      "Does not execute AgentLoop or measure autonomous coding success.",
      "Must not be reported as an Agent task success rate.",
    ],
  },
});
if (asJson) {
  process.stdout.write(evalReportToJson(report) + "\n");
} else {
  process.stdout.write(
    formatEvalReport(report, { title: "🧪 Qling eval:tasks (deterministic component fixtures)" }).join("\n") + "\n"
  );
}

process.exit(report.fail === 0 ? 0 : 1);
