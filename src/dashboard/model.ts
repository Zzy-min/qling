import type { LocalSessionTask } from "../session-task-report.js";
import type { Mission, MissionStatus } from "../mission/types.js";
import type { WorkflowCheckpoint } from "../workflow-types.js";
import type {
  DashboardTask,
  DashboardTaskAction,
  DashboardTaskStatus,
} from "./types.js";

const ACTIVE_RANK: Record<DashboardTaskStatus, number> = {
  running: 0,
  blocked: 1,
  queued: 2,
  paused: 3,
  exhausted: 9,
  failed: 10,
  canceled: 11,
  succeeded: 12,
};

function summarize(value: unknown, limit = 240): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

export function getMissionActions(
  status: MissionStatus,
  daemonHealthy: boolean
): DashboardTaskAction[] {
  if (status === "running" || status === "blocked" || status === "queued") {
    return ["pause", "cancel"];
  }
  if (status === "paused") return ["resume", "cancel"];
  if (daemonHealthy && ["succeeded", "exhausted", "failed", "canceled"].includes(status)) {
    return ["retry"];
  }
  return [];
}

function missionTask(mission: Mission, daemonHealthy: boolean): DashboardTask {
  return {
    id: mission.id,
    kind: "mission",
    title: summarize(mission.name, 100) || "未命名使命",
    description: summarize(mission.description),
    status: mission.status,
    rawStatus: mission.status,
    source: daemonHealthy ? "daemon" : "local",
    sessionId: mission.sessionId,
    createdAt: mission.createdAt,
    updatedAt: mission.updatedAt,
    startedAt: mission.metrics.startTime,
    endedAt: mission.metrics.endTime,
    progress: {
      turns: mission.metrics.totalTurns,
      tokens: mission.metrics.totalTokens,
      toolCalls: mission.metrics.totalToolCalls,
    },
    error: mission.error
      ? { code: mission.error.code, message: summarize(mission.error.message, 300) }
      : undefined,
    actions: getMissionActions(mission.status, daemonHealthy),
  };
}

function loopStatus(status: LocalSessionTask["status"]): DashboardTaskStatus {
  if (status === "active") return "queued";
  if (status === "completed") return "succeeded";
  return status;
}

function loopTask(task: LocalSessionTask): DashboardTask {
  const status = loopStatus(task.status);
  return {
    id: task.id,
    kind: "loop",
    title: summarize(task.prompt, 100) || "循环任务",
    description: `每 ${Math.max(1, Math.round(task.intervalMs / 1000))} 秒执行 · ${task.mode}`,
    status,
    rawStatus: task.status,
    source: task.runner === "daemon" ? "daemon" : "session",
    sessionId: task.sessionId,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    startedAt: task.lastRunAt,
    nextRunAt: task.nextRunAt,
    actions: status === "queued" || status === "running" ? ["cancel"] : [],
  };
}

function workflowTask(checkpoint: WorkflowCheckpoint): DashboardTask {
  const status: DashboardTaskStatus =
    checkpoint.status === "completed"
      ? "succeeded"
      : checkpoint.status === "awaiting_approval"
        ? "blocked"
        : checkpoint.status;
  return {
    id: checkpoint.runId,
    kind: "workflow",
    title: `Workflow · ${summarize(checkpoint.currentState, 80)}`,
    description: summarize(checkpoint.workflowDefinition?.description ?? checkpoint.workflowId),
    status,
    rawStatus: checkpoint.status,
    source: "local",
    sessionId: checkpoint.sessionId,
    createdAt: checkpoint.history[0]?.timestamp ?? checkpoint.updatedAt,
    updatedAt: checkpoint.updatedAt,
    progress: { toolCalls: checkpoint.completedToolResults.length },
    error: checkpoint.error
      ? { message: summarize(checkpoint.error.message, 300) }
      : undefined,
    actions: [],
  };
}

export function buildDashboardTasks(options: {
  missions: Mission[];
  loops: LocalSessionTask[];
  workflow: WorkflowCheckpoint | null;
  daemonHealthy: boolean;
  now?: number;
}): DashboardTask[] {
  const tasks = [
    ...options.missions.map((mission) => missionTask(mission, options.daemonHealthy)),
    ...options.loops.map(loopTask),
    ...(options.workflow ? [workflowTask(options.workflow)] : []),
  ];
  return tasks.sort((a, b) => {
    const rank = ACTIVE_RANK[a.status] - ACTIVE_RANK[b.status];
    if (rank !== 0) return rank;
    const updated = b.updatedAt - a.updatedAt;
    return updated !== 0 ? updated : a.id.localeCompare(b.id);
  });
}
