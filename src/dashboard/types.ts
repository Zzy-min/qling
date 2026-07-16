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

/** 最近会话摘要（只读，便于 /resume） */
export interface DashboardSessionSummary {
  sessionId: string;
  name: string;
  updatedAt: string;
  turnCount: number;
  messageCount: number;
  sessionTokens: number;
  active: boolean;
  /** G4.3 深链：在 TUI 恢复该会话的 CLI 命令 */
  resumeCommand?: string;
}

export interface DashboardAgentLive {
  sessionId: string;
  turnCount: number;
  ready: boolean;
}

export interface DashboardBudget {
  sessionTokens: number;
  /** 可选上限；未知时为 null */
  contextLimit: number | null;
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
  /** 最近会话（只读） */
  sessions: DashboardSessionSummary[];
  agentLive?: DashboardAgentLive;
  budget?: DashboardBudget;
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
