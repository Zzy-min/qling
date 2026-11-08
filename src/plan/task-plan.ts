import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getRuntimeRootsFromEnv, resolveEffectiveWorkspace, resolveWorkspaceStatePath } from "../runtime-paths.js";
import type { ExecutionStrategyTier } from "../execution/types.js";
import { enqueueFileOperation } from "../persistence/atomic-json.js";

export type TaskPlanStatus =
  | "pending"
  | "planning"
  | "running"
  | "verifying"
  | "replanning"
  | "waiting_approval"
  | "completed"
  | "partially_completed"
  | "failed"
  | "canceled";

export type TaskPlanStepStatus =
  | "pending"
  | "in_progress"
  | "verifying"
  | "completed"
  | "failed"
  | "skipped"
  | "blocked";

export interface TaskPlanStepInput {
  id?: string;
  title: string;
  dependsOn?: string[];
  order?: number;
  requiredTools?: string[];
  expectedOutput?: string;
  acceptanceCriteria?: string;
  status?: TaskPlanStepStatus;
  recoveryStrategy?: string;
  /** Caller-reported notes only; not proof of runtime verification. */
  verificationEvidence?: string;
  failureReason?: string;
}

export interface TaskPlanStep {
  id: string;
  title: string;
  dependsOn: string[];
  order: number;
  requiredTools: string[];
  expectedOutput: string;
  acceptanceCriteria: string;
  status: TaskPlanStepStatus;
  recoveryStrategy: string;
  /** Legacy field name for caller-reported notes, never a trusted verification result. */
  verificationEvidence?: string;
  failureReason?: string;
  updatedAt: number;
}

export interface TaskReplanHistoryEntry {
  timestamp: number;
  reason: string;
  preservedStepIds: string[];
  updatedStepIds: string[];
}

export interface StructuredTaskPlan {
  planId: string;
  objective: string;
  /** Immutable SHA-256 hash of the initial objective (PlanGuard invariant). */
  baselineObjectiveHash: string;
  strategyTier: ExecutionStrategyTier;
  status: TaskPlanStatus;
  steps: TaskPlanStep[];
  replanCount: number;
  replanHistory: TaskReplanHistoryEntry[];
  createdAt: number;
  updatedAt: number;
}

export interface TaskPlanSummary {
  planId: string;
  objective: string;
  status: TaskPlanStatus;
  strategyTier: ExecutionStrategyTier;
  totalSteps: number;
  completedSteps: number;
  /** No trusted per-step verifier is connected yet; caller strings cannot increment this. */
  verifiedSteps: number;
  verificationStatus: "unverified";
  pendingSteps: number;
  inProgressSteps: number;
  failedSteps: number;
  blockedSteps: number;
  readyStepIds: string[];
  unmetStepIds: string[];
  /** All steps are reported completed or explicitly skipped; does not mean verified. */
  isComplete: boolean;
  isPartiallyComplete: boolean;
  replanCount: number;
}

export function hashPlanObjective(objective: string): string {
  return createHash("sha256")
    .update(objective.trim().replace(/\s+/g, " "), "utf8")
    .digest("hex")
    .slice(0, 24);
}

export function validatePlanDependencies(
  steps: ReadonlyArray<Pick<TaskPlanStep, "id" | "dependsOn">>
): { ok: boolean; error?: string; topologicalOrder: string[] } {
  const idSet = new Set<string>();
  for (const step of steps) {
    if (!step.id || !step.id.trim()) {
      return { ok: false, error: "Step ID cannot be empty", topologicalOrder: [] };
    }
    if (idSet.has(step.id)) {
      return { ok: false, error: `Duplicate step ID: ${step.id}`, topologicalOrder: [] };
    }
    idSet.add(step.id);
  }

  for (const step of steps) {
    for (const dep of step.dependsOn) {
      if (!idSet.has(dep)) {
        return {
          ok: false,
          error: `Step "${step.id}" depends on unknown step "${dep}"`,
          topologicalOrder: [],
        };
      }
      if (dep === step.id) {
        return {
          ok: false,
          error: `Step "${step.id}" cannot depend on itself`,
          topologicalOrder: [],
        };
      }
    }
  }

  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const step of steps) {
    inDegree.set(step.id, step.dependsOn.length);
    adjacency.set(step.id, []);
  }
  for (const step of steps) {
    for (const dep of step.dependsOn) {
      adjacency.get(dep)?.push(step.id);
    }
  }

  const queue: string[] = [];
  for (const step of steps) {
    if ((inDegree.get(step.id) ?? 0) === 0) {
      queue.push(step.id);
    }
  }

  const topologicalOrder: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    topologicalOrder.push(current);
    for (const next of adjacency.get(current) ?? []) {
      const nextDegree = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, nextDegree);
      if (nextDegree === 0) {
        queue.push(next);
      }
    }
  }

  if (topologicalOrder.length !== steps.length) {
    return {
      ok: false,
      error: "Circular dependency detected in task plan steps",
      topologicalOrder: [],
    };
  }

  return { ok: true, topologicalOrder };
}

function normalizeSteps(inputs: (TaskPlanStepInput | string)[], now: number): TaskPlanStep[] {
  return inputs.map((input, idx) => {
    const item = typeof input === "string" ? { title: input } : input;
    const id = item.id?.trim() || `step-${idx + 1}`;
    return {
      id,
      title: item.title.trim() || `步骤 ${idx + 1}`,
      dependsOn: Array.isArray(item.dependsOn)
        ? [...new Set(item.dependsOn.map((d) => String(d).trim()).filter(Boolean))]
        : idx > 0 && item.dependsOn === undefined
          ? []
          : [],
      order: typeof item.order === "number" && Number.isFinite(item.order) ? item.order : idx + 1,
      requiredTools: Array.isArray(item.requiredTools)
        ? item.requiredTools.map((t) => String(t).trim()).filter(Boolean)
        : [],
      expectedOutput: item.expectedOutput?.trim() || "完成该子任务并产生可验证证据",
      acceptanceCriteria: item.acceptanceCriteria?.trim() || "工具调用成功且结果通过验证",
      status: item.status ?? "pending",
      recoveryStrategy: item.recoveryStrategy?.trim() || "分析失败原因、切换工具或调整参数后重试",
      ...(item.verificationEvidence ? { verificationEvidence: item.verificationEvidence } : {}),
      ...(item.failureReason ? { failureReason: item.failureReason } : {}),
      updatedAt: now,
    };
  });
}

/** Validate the whole proposed state, including dependents of a reopened prerequisite. */
function assertPlanStepState(steps: ReadonlyArray<TaskPlanStep>): void {
  const validStatuses = new Set<TaskPlanStepStatus>([
    "pending", "in_progress", "verifying", "completed", "failed", "skipped", "blocked",
  ]);
  const statusById = new Map(steps.map((step) => [step.id, step.status]));
  for (const step of steps) {
    if (!validStatuses.has(step.status)) {
      throw new Error(`Invalid plan step status for "${step.id}": ${String(step.status)}`);
    }
    if (step.status !== "in_progress" && step.status !== "verifying" && step.status !== "completed") continue;
    const unmet = step.dependsOn.filter((id) => {
      const status = statusById.get(id);
      return status !== "completed" && status !== "skipped";
    });
    if (unmet.length > 0) {
      throw new Error(
        `Cannot set plan step "${step.id}" to ${step.status}: dependencies must be completed or explicitly skipped first: ${unmet.join(", ")}`,
      );
    }
  }
}

export function derivePlanStatus(
  steps: ReadonlyArray<TaskPlanStep>,
  currentStatus: TaskPlanStatus = "pending"
): TaskPlanStatus {
  if (currentStatus === "canceled" || currentStatus === "waiting_approval") {
    return currentStatus;
  }
  if (steps.length === 0) return "planning";

  const counts = {
    completed: 0,
    skipped: 0,
    failed: 0,
    blocked: 0,
    verifying: 0,
    inProgress: 0,
    pending: 0,
  };
  for (const step of steps) {
    if (step.status === "completed") counts.completed++;
    else if (step.status === "skipped") counts.skipped++;
    else if (step.status === "failed") counts.failed++;
    else if (step.status === "blocked") counts.blocked++;
    else if (step.status === "verifying") counts.verifying++;
    else if (step.status === "in_progress") counts.inProgress++;
    else counts.pending++;
  }

  const doneCount = counts.completed + counts.skipped;
  if (doneCount === steps.length) {
    return "completed";
  }
  if (counts.verifying > 0) {
    return "verifying";
  }
  if (counts.failed > 0 && counts.inProgress === 0 && counts.pending === 0) {
    return doneCount > 0 ? "partially_completed" : "failed";
  }
  if (counts.blocked > 0 && counts.inProgress === 0 && counts.pending === 0) {
    return doneCount > 0 ? "partially_completed" : "waiting_approval";
  }
  if (counts.inProgress > 0 || doneCount > 0 || counts.failed > 0) {
    return "running";
  }
  return "pending";
}

export function createStructuredTaskPlan(input: {
  planId?: string;
  objective: string;
  strategyTier?: ExecutionStrategyTier;
  steps: (TaskPlanStepInput | string)[];
  status?: TaskPlanStatus;
  now?: number;
}): StructuredTaskPlan {
  const now = input.now ?? Date.now();
  const objective = input.objective.trim();
  if (!objective) {
    throw new Error("Task plan objective cannot be empty");
  }
  const steps = normalizeSteps(input.steps, now);
  const validation = validatePlanDependencies(steps);
  if (!validation.ok) {
    throw new Error(`Invalid task plan dependencies: ${validation.error}`);
  }
  assertPlanStepState(steps);
  const rankMap = new Map(validation.topologicalOrder.map((id, index) => [id, index + 1]));
  for (const step of steps) {
    step.order = rankMap.get(step.id) ?? step.order;
  }
  steps.sort((a, b) => a.order - b.order);

  const status = input.status ?? derivePlanStatus(steps, "pending");
  return {
    planId: input.planId?.trim() || `plan_${randomUUID().slice(0, 12)}`,
    objective,
    baselineObjectiveHash: hashPlanObjective(objective),
    strategyTier: input.strategyTier ?? "full_plan",
    status,
    steps,
    replanCount: 0,
    replanHistory: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function getReadyPlanSteps(plan: StructuredTaskPlan): TaskPlanStep[] {
  const statusById = new Map(plan.steps.map((s) => [s.id, s.status]));
  return plan.steps.filter((step) => {
    if (step.status !== "pending" && step.status !== "in_progress") {
      return false;
    }
    return step.dependsOn.every((depId) => {
      const depStatus = statusById.get(depId);
      return depStatus === "completed" || depStatus === "skipped";
    });
  });
}

export function updatePlanStepStatus(
  plan: StructuredTaskPlan,
  stepId: string,
  update: {
    status: TaskPlanStepStatus;
    verificationEvidence?: string;
    failureReason?: string;
    expectedOutput?: string;
    acceptanceCriteria?: string;
    now?: number;
  }
): StructuredTaskPlan {
  const now = update.now ?? Date.now();
  const target = plan.steps.find((s) => s.id === stepId);
  if (!target) {
    throw new Error(`Plan step "${stepId}" not found in plan "${plan.planId}"`);
  }
  const nextSteps = plan.steps.map((step) => {
    if (step.id !== stepId) return { ...step, dependsOn: [...step.dependsOn], requiredTools: [...step.requiredTools] };
    return {
      ...step,
      dependsOn: [...step.dependsOn],
      requiredTools: [...step.requiredTools],
      status: update.status,
      ...(update.verificationEvidence !== undefined
        ? { verificationEvidence: update.verificationEvidence }
        : {}),
      ...(update.failureReason !== undefined ? { failureReason: update.failureReason } : {}),
      ...(update.expectedOutput !== undefined ? { expectedOutput: update.expectedOutput } : {}),
      ...(update.acceptanceCriteria !== undefined
        ? { acceptanceCriteria: update.acceptanceCriteria }
        : {}),
      updatedAt: now,
    };
  });

  const validation = validatePlanDependencies(nextSteps);
  if (!validation.ok) {
    throw new Error(`Invalid task plan dependencies: ${validation.error}`);
  }
  assertPlanStepState(nextSteps);

  const nextStatus = derivePlanStatus(nextSteps, plan.status === "waiting_approval" ? "running" : plan.status);
  return {
    ...plan,
    steps: nextSteps,
    status: nextStatus,
    updatedAt: now,
  };
}

/**
 * Dynamic replanning with PlanGuard protection:
 * 1. Verifies the baseline objective hash was not silently mutated.
 * 2. Preserves all steps that are already completed, avoiding duplicate work.
 * 3. Replaces or updates remaining/failed steps and validates the new dependency DAG.
 */
export function replanStructuredTaskPlan(
  plan: StructuredTaskPlan,
  options: {
    reason: string;
    newSteps: (TaskPlanStepInput | string)[];
    objective?: string;
    allowObjectiveOverride?: boolean;
    now?: number;
  }
): StructuredTaskPlan {
  const now = options.now ?? Date.now();
  if (
    options.objective &&
    hashPlanObjective(options.objective) !== plan.baselineObjectiveHash &&
    !options.allowObjectiveOverride
  ) {
    throw new Error(
      "PlanGuard violation: dynamic replanning cannot alter the baseline task objective without explicit override"
    );
  }

  const oldPlanIds = new Set(plan.steps.map((s) => s.id));
  const preservedSteps = plan.steps
    .filter((step) => step.status === "completed")
    .map((step) => ({
      ...step,
      dependsOn: [...step.dependsOn],
      requiredTools: [...step.requiredTools],
    }));
  const preservedIds = new Set(preservedSteps.map((s) => s.id));

  const candidateIncoming = normalizeSteps(options.newSteps, now).filter(
    (step) => !preservedIds.has(step.id)
  );

  const combinedSteps: TaskPlanStep[] = [...preservedSteps, ...candidateIncoming];
  const validIds = new Set(combinedSteps.map((s) => s.id));
  const oldStatusById = new Map(plan.steps.map((step) => [step.id, step.status]));
  for (const step of combinedSteps) {
    // Pending replacements may drop old removed dependencies. Active/completed steps must
    // never become valid merely because an unresolved prerequisite was silently removed.
    step.dependsOn = step.dependsOn.filter((depId) => {
      if (validIds.has(depId) || !oldPlanIds.has(depId)) return true;
      if (oldStatusById.get(depId) === "skipped") return false; // Explicitly waived prerequisite.
      return step.status === "in_progress" || step.status === "verifying" || step.status === "completed";
    });
  }

  const validation = validatePlanDependencies(combinedSteps);
  if (!validation.ok) {
    throw new Error(`Invalid replanned task dependencies: ${validation.error}`);
  }
  assertPlanStepState(combinedSteps);
  const rankMap = new Map(validation.topologicalOrder.map((id, index) => [id, index + 1]));
  for (const step of combinedSteps) {
    step.order = rankMap.get(step.id) ?? step.order;
  }
  combinedSteps.sort((a, b) => a.order - b.order);

  const nextStatus = derivePlanStatus(combinedSteps, "running");
  return {
    ...plan,
    objective: options.allowObjectiveOverride && options.objective ? options.objective.trim() : plan.objective,
    steps: combinedSteps,
    status: nextStatus,
    replanCount: plan.replanCount + 1,
    replanHistory: [
      ...plan.replanHistory,
      {
        timestamp: now,
        reason: options.reason.trim() || "runtime replan",
        preservedStepIds: [...preservedIds],
        updatedStepIds: candidateIncoming.map((s) => s.id),
      },
    ],
    updatedAt: now,
  };
}

export const replanTaskPlan = replanStructuredTaskPlan;

export function summarizeTaskPlan(plan: StructuredTaskPlan): TaskPlanSummary {
  let completedSteps = 0;
  // No trusted per-step verifier is connected. Persisted/model-supplied strings,
  // completed statuses and explicit skips are bookkeeping, not deterministic evidence.
  const verifiedSteps = 0;
  let pendingSteps = 0;
  let inProgressSteps = 0;
  let failedSteps = 0;
  let blockedSteps = 0;
  const unmetStepIds: string[] = [];

  for (const step of plan.steps) {
    if (step.status === "completed" || step.status === "skipped") {
      completedSteps++;
    } else if (step.status === "pending") {
      pendingSteps++;
      unmetStepIds.push(step.id);
    } else if (step.status === "in_progress" || step.status === "verifying") {
      inProgressSteps++;
      unmetStepIds.push(step.id);
    } else if (step.status === "failed") {
      failedSteps++;
      unmetStepIds.push(step.id);
    } else if (step.status === "blocked") {
      blockedSteps++;
      unmetStepIds.push(step.id);
    }
  }

  const totalSteps = plan.steps.length;
  const isComplete = totalSteps > 0 && completedSteps === totalSteps;
  const isPartiallyComplete = completedSteps > 0 && completedSteps < totalSteps;
  const readyStepIds = getReadyPlanSteps(plan).map((s) => s.id);

  return {
    planId: plan.planId,
    objective: plan.objective,
    status: derivePlanStatus(plan.steps, plan.status),
    strategyTier: plan.strategyTier,
    totalSteps,
    completedSteps,
    verifiedSteps,
    verificationStatus: "unverified",
    pendingSteps,
    inProgressSteps,
    failedSteps,
    blockedSteps,
    readyStepIds,
    unmetStepIds,
    isComplete,
    isPartiallyComplete,
    replanCount: plan.replanCount,
  };
}

export function formatTaskPlanMarkdown(plan: StructuredTaskPlan): string {
  const summary = summarizeTaskPlan(plan);
  const lines: string[] = [
    `# 任务计划 (${plan.planId})`,
    "",
    `- **目标**: ${plan.objective}`,
    `- **策略层级**: ${plan.strategyTier}`,
    `- **计划状态**: ${summary.status} (${summary.completedSteps}/${summary.totalSteps} 报告完成或跳过, 重规划 ${plan.replanCount} 次)`,
    "- **运行时步骤验证**: 未验证 (unverified；当前未关联可信的步骤验证器，完成状态和备注仅为报告)",
    `- **可执行下一步**: ${summary.readyStepIds.length > 0 ? summary.readyStepIds.join(", ") : "(无待执行步骤)"}`,
    "",
    "## 子任务列表",
  ];

  for (const step of plan.steps) {
    const deps = step.dependsOn.length > 0 ? ` [依赖: ${step.dependsOn.join(", ")}]` : "";
    const tools = step.requiredTools.length > 0 ? ` [工具: ${step.requiredTools.join(", ")}]` : "";
    lines.push(
      `${step.order}. [${step.status}] **${step.id}**: ${step.title}${deps}${tools}`,
      `   - 预期产出: ${step.expectedOutput}`,
      `   - 验收标准: ${step.acceptanceCriteria}`,
      `   - 恢复策略: ${step.recoveryStrategy}`
    );
    if (step.verificationEvidence) {
      lines.push(`   - 完成报告/备注（未验证）: ${step.verificationEvidence}`);
    }
    if (step.failureReason) {
      lines.push(`   - 失败原因: ${step.failureReason}`);
    }
  }

  if (plan.replanHistory.length > 0) {
    lines.push("", "## 动态重规划记录");
    for (const entry of plan.replanHistory.slice(-5)) {
      lines.push(
        `- 原因: ${entry.reason} (保留报告完成步骤: ${entry.preservedStepIds.join(", ") || "无"}; 更新步骤: ${entry.updatedStepIds.join(", ") || "无"})`
      );
    }
  }

  return lines.join("\n") + "\n";
}

export function resolveWorkspacePlansDir(workspaceDir?: string | null): string {
  return resolvePlanStatePath(workspaceDir);
}

function resolvePlanStatePath(workspaceDir?: string | null, ...parts: string[]): string {
  const base = workspaceDir?.trim() ? path.resolve(workspaceDir) : resolveEffectiveWorkspace(getRuntimeRootsFromEnv());
  return resolveWorkspaceStatePath(base, ".qling", "plans", ...parts);
}

function writeTextFileAtomicSync(targetPath: string, content: string): void {
  const dir = path.dirname(targetPath);
  mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(
    dir,
    `.${path.basename(targetPath)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`,
  );
  try {
    writeFileSync(tmpPath, content, "utf8");
    renameSync(tmpPath, targetPath);
  } catch (err) {
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      // ignore cleanup error
    }
    throw err;
  }
}

export function saveWorkspaceTaskPlan(
  workspaceDir: string | null | undefined,
  plan: StructuredTaskPlan
): { jsonPath: string; markdownPath: string; baselinePath: string } {
  const dir = resolveWorkspacePlansDir(workspaceDir);
  const jsonPath = resolvePlanStatePath(workspaceDir, "active-plan.json");
  const markdownPath = resolvePlanStatePath(workspaceDir, "plan.md");
  const baselinePath = resolvePlanStatePath(workspaceDir, "plan.baseline.md");
  mkdirSync(dir, { recursive: true });

  const markdown = formatTaskPlanMarkdown(plan);
  writeTextFileAtomicSync(jsonPath, JSON.stringify(plan, null, 2));
  writeTextFileAtomicSync(markdownPath, markdown);
  if (!existsSync(baselinePath)) {
    writeTextFileAtomicSync(baselinePath, markdown);
  }
  return { jsonPath, markdownPath, baselinePath };
}

export async function withWorkspacePlanLock<T>(
  workspaceDir: string | null | undefined,
  fn: () => Promise<T> | T,
): Promise<T> {
  const jsonPath = resolvePlanStatePath(workspaceDir, "active-plan.json");
  let result!: T;
  await enqueueFileOperation(jsonPath, async () => {
    result = await fn();
  });
  return result;
}

export function loadWorkspaceTaskPlan(
  workspaceDir?: string | null
): StructuredTaskPlan | null {
  try {
    const jsonPath = resolvePlanStatePath(workspaceDir, "active-plan.json");
    if (!existsSync(jsonPath)) return null;
    const raw = JSON.parse(readFileSync(jsonPath, "utf8")) as StructuredTaskPlan;
    if (!raw || typeof raw.objective !== "string" || !Array.isArray(raw.steps)) {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}
