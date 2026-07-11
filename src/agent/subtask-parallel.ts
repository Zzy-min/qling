// ============================================================
// Phase 3.2+ — 只读 explore 并行（默认关闭）
// 启用：QLING_SUBTASK_PARALLEL=1
// ============================================================

import type { SubtaskResult } from "./subtask.js";
import { normalizeSubAgentRole, type SubAgentRole } from "../agents/roles.js";

const ENABLED = new Set(["1", "true", "on", "yes"]);

export function isSubtaskParallelEnabled(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): boolean {
  const raw = String(env.QLING_SUBTASK_PARALLEL ?? "").trim().toLowerCase();
  return ENABLED.has(raw);
}

export function resolveParallelMax(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): number {
  const n = Number(env.QLING_SUBTASK_PARALLEL_MAX ?? 3);
  if (!Number.isFinite(n) || n < 1) return 3;
  return Math.min(5, Math.floor(n));
}

/**
 * 解析并行任务列表：优先 tasks 数组，否则空。
 */
export function parseParallelTasks(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((t) => String(t ?? "").trim()).filter(Boolean);
  }
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) {
        return parsed.map((t) => String(t ?? "").trim()).filter(Boolean);
      }
    } catch {
      // 按换行或 || 分割
      return s
        .split(/\n+|\|\|/)
        .map((t) => t.trim())
        .filter(Boolean);
    }
  }
  return [];
}

export interface ParallelExploreGate {
  ok: boolean;
  errorCode?: string;
  errorMessage?: string;
  tasks: string[];
  role: SubAgentRole;
}

/**
 * 校验是否允许并行：仅 explore/review 只读角色；须显式开启。
 */
export function gateParallelExplore(options: {
  tasks: string[];
  role?: unknown;
  enabled?: boolean;
  max?: number;
}): ParallelExploreGate {
  const enabled = options.enabled ?? isSubtaskParallelEnabled();
  const max = options.max ?? resolveParallelMax();
  const tasks = options.tasks.filter(Boolean);
  const role = normalizeSubAgentRole(options.role ?? "explore");

  if (tasks.length === 0) {
    return {
      ok: false,
      errorCode: "SUBTASK_PARALLEL_EMPTY",
      errorMessage: "tasks 为空",
      tasks: [],
      role,
    };
  }

  if (!enabled) {
    return {
      ok: false,
      errorCode: "SUBTASK_PARALLEL_DISABLED",
      errorMessage:
        "并行 subtask 默认关闭。启用: QLING_SUBTASK_PARALLEL=1（仅 explore/review 只读角色）",
      tasks,
      role,
    };
  }

  if (role === "implement") {
    return {
      ok: false,
      errorCode: "SUBTASK_PARALLEL_ROLE",
      errorMessage:
        "并行仅允许 role=explore 或 review（只读）。写操作必须串行 implement。",
      tasks,
      role,
    };
  }

  if (tasks.length > max) {
    return {
      ok: false,
      errorCode: "SUBTASK_PARALLEL_TOO_MANY",
      errorMessage: `并行任务过多: ${tasks.length} > max ${max}（QLING_SUBTASK_PARALLEL_MAX）`,
      tasks,
      role,
    };
  }

  return { ok: true, tasks, role };
}

export function formatParallelExploreReport(
  results: Array<{ task: string; result: SubtaskResult }>
): string {
  const lines = [
    "【并行探索回传】",
    `count: ${results.length}`,
    `ok: ${results.filter((r) => r.result.success).length}`,
    `fail: ${results.filter((r) => !r.result.success).length}`,
    "",
  ];
  results.forEach((item, i) => {
    lines.push(`--- task[${i + 1}] ${item.result.success ? "OK" : "FAIL"} ---`);
    lines.push(`goal: ${item.task.slice(0, 200)}`);
    lines.push(item.result.contractText || item.result.output);
    lines.push("");
  });
  return lines.join("\n").trim();
}
