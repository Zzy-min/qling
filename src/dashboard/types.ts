import type { MetricEvent } from "../metrics/types.js";
import type { MissionStatus } from "../mission/types.js";
import type { SessionTaskStatus } from "../session/session-scheduler.js";
import type { WorkflowCheckpoint } from "../workflow-types.js";

export type DashboardTaskKind = "mission" | "loop" | "workflow";
export type DashboardTaskStatus =
  | "queued"
  | "running"
  | "blocked"
  | "paused"
  | "succeeded"
  | "failed"
  | "canceled";
export type DashboardTaskAction = "pause" | "resume" | "cancel" | "retry";

export interface DashboardTask {
  id: string;
  kind: DashboardTaskKind;
  title: string;
  description: string;
  status: DashboardTaskStatus;
  rawStatus: MissionStatus | SessionTaskStatus | WorkflowCheckpoint["status"];
  source: "daemon" | "local" | "session";
  sessionId?: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  endedAt?: number;
  nextRunAt?: number;
  progress?: {
    turns?: number;
    tokens?: number;
    toolCalls?: number;
  };
  error?: { code?: string; message: string };
  actions: DashboardTaskAction[];
}

export interface DashboardSnapshot {
  generatedAt: number;
  revision: string;
  runtime: {
    ready: boolean;
    sessionId: string;
    daemonHealthy: boolean;
    daemonSource: "daemon" | "local";
    permissionMode: string;
  };
  summary: Record<DashboardTaskStatus | "total", number>;
  tasks: DashboardTask[];
  activity: MetricEvent[];
  boundary: {
    localOnly: true;
    activityTruncated: boolean;
    activityScannedBytes: number;
  };
}

export interface DashboardTaskDetail {
  task: DashboardTask;
  detail: Record<string, unknown>;
  events: Array<Record<string, unknown>>;
}

export interface DashboardControlResult {
  ok: boolean;
  source: "daemon" | "local";
  task?: DashboardTask;
  message: string;
}
