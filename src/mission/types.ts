// ============================================================
// 轻灵 - Mission Types (v0.5+)
// 使命级任务模型：支持异步脱离、队列管理、细粒度生命周期状态机与结果判定追踪
// ============================================================

import { Message, ToolCall, ToolResult } from "../types.js";
import type { ExecutionStrategyTier, TaskCompletionStatus } from "../execution/types.js";
import { WorkflowCheckpoint } from "../workflow-types.js";

export type MissionStatus =
  | "queued"
  | "running"
  | "blocked"
  | "paused"
  | "exhausted"
  | "succeeded"
  | "failed"
  | "canceled";

/**
 * 阶段三.3：细粒度任务生命周期状态机
 * 覆盖 Pending、Planning、Running、Verifying、Replanning、WaitingApproval、
 * Completed、PartiallyCompleted、Failed、Cancelled。
 */
export type MissionLifecyclePhase =
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

export function lifecyclePhaseToMissionStatus(phase: MissionLifecyclePhase): MissionStatus {
  switch (phase) {
    case "pending":
      return "queued";
    case "planning":
    case "running":
    case "verifying":
    case "replanning":
      return "running";
    case "waiting_approval":
      return "blocked";
    case "completed":
      return "succeeded";
    case "partially_completed":
      return "paused";
    case "failed":
      return "failed";
    case "canceled":
      return "canceled";
  }
}

export function missionStatusToLifecyclePhase(
  status: MissionStatus,
  completionStatus?: TaskCompletionStatus
): MissionLifecyclePhase {
  if (completionStatus === "partially_completed") return "partially_completed";
  switch (status) {
    case "queued":
      return "pending";
    case "running":
      return "running";
    case "blocked":
      return "waiting_approval";
    case "paused":
    case "exhausted":
      return "partially_completed";
    case "succeeded":
      return "completed";
    case "failed":
      return "failed";
    case "canceled":
      return "canceled";
  }
}

export interface Mission {
  id: string;
  name: string;
  description: string;
  status: MissionStatus;
  /** 细粒度生命周期阶段（与 status 保持前后端一致） */
  lifecyclePhase?: MissionLifecyclePhase;
  /** 独立结果判定状态 */
  completionStatus?: TaskCompletionStatus;
  /** 动态推理策略层级 */
  strategyTier?: ExecutionStrategyTier;
  /** 关联的结构化计划进度 */
  planProgress?: {
    planId?: string;
    completedSteps: number;
    totalSteps: number;
    replanCount: number;
  };

  /** 关联的会话与工作流信息 */
  sessionId: string;
  workflowRunId?: string;
  sourceMissionId?: string;

  /** 执行上下文快照 */
  lastContext: Message[];

  /** 统计数据 */
  metrics: {
    startTime: number;
    endTime?: number;
    totalTurns: number;
    totalTokens: number;
    totalToolCalls: number;
  };

  /**
   * Pid of the process that moved this mission to running.
   * Legacy snapshots omit it and are treated as not alive on restart.
   */
  ownerPid?: number;

  /** 错误信息 */
  error?: {
    message: string;
    code: string;
    stack?: string;
  };

  createdAt: number;
  updatedAt: number;
}

export interface MissionEvent {
  missionId: string;
  type: "state_changed" | "control" | "log";
  timestamp: number;
  data: Record<string, unknown>;
}
