// ============================================================
// 轻灵 - Mission Types (v0.5)
// 使命级任务模型：支持异步脱离、队列管理与全局状态追踪
// ============================================================

import { Message, ToolCall, ToolResult } from "../types.js";
import { WorkflowCheckpoint } from "../workflow-types.js";

export type MissionStatus =
  | "queued"
  | "running"
  | "blocked"
  | "paused"
  | "succeeded"
  | "failed"
  | "canceled";

export interface Mission {
  id: string;
  name: string;
  description: string;
  status: MissionStatus;

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
