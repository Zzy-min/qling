// ============================================================
// 轻灵 - 评测 runner
// ============================================================

import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { EvalReport, EvalTask, EvalTaskResult } from "./types.js";
import { buildEvalSmokeTasks } from "./tasks.js";

export interface RunEvalOptions {
  tasks?: EvalTask[];
  /** 保留临时目录（调试） */
  keepTemp?: boolean;
}

export async function runEvalSuite(options: RunEvalOptions = {}): Promise<EvalReport> {
  const tasks = options.tasks ?? buildEvalSmokeTasks();
  const started = Date.now();
  const results: EvalTaskResult[] = [];
  const workspaceDir = await mkdtemp(join(tmpdir(), "qling-eval-"));

  try {
    for (const task of tasks) {
      const t0 = Date.now();
      try {
        const outcome = await task.run({
          workspaceDir,
          env: process.env,
        });
        results.push({
          id: task.id,
          title: task.title,
          status: outcome.ok ? "pass" : "fail",
          detail: outcome.detail,
          durationMs: Date.now() - t0,
        });
      } catch (err) {
        results.push({
          id: task.id,
          title: task.title,
          status: "fail",
          detail: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - t0,
        });
      }
    }
  } finally {
    if (!options.keepTemp) {
      await rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  const pass = results.filter((r) => r.status === "pass").length;
  const fail = results.filter((r) => r.status === "fail").length;
  const skip = results.filter((r) => r.status === "skip").length;

  return {
    total: results.length,
    pass,
    fail,
    skip,
    results,
    durationMs: Date.now() - started,
  };
}

export function formatEvalReport(report: EvalReport): string[] {
  const lines = [
    "",
    "🧪 Qling eval:smoke",
    "-----------------------------------------",
    `summary: pass=${report.pass} fail=${report.fail} skip=${report.skip} total=${report.total} (${report.durationMs}ms)`,
  ];
  for (const r of report.results) {
    const icon = r.status === "pass" ? "PASS" : r.status === "skip" ? "SKIP" : "FAIL";
    lines.push(`[${icon}] ${r.id} — ${r.title} (${r.durationMs}ms)`);
    if (r.status !== "pass" || process.env.QLING_EVAL_VERBOSE === "1") {
      lines.push(`       ${r.detail}`);
    }
  }
  lines.push("-----------------------------------------");
  lines.push(report.fail === 0 ? "✅ eval:smoke passed" : "❌ eval:smoke failed");
  lines.push("");
  return lines;
}

export function evalReportToJson(report: EvalReport): string {
  return JSON.stringify(report, null, 2);
}
