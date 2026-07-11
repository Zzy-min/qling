// ============================================================
// 轻灵 - Workflow DSL & Types (v0.3)
// 代码优先的状态机定义，支持 Checkpoint 序列化
// ============================================================

import { Message, ToolCall, ToolResult } from "./types.js";

/**
 * 状态机状态定义
 */
export interface WorkflowState {
  id: string;
  description: string;
  /** 执行该状态时的逻辑类型 */
  type: "task" | "approval" | "condition" | "end";
  /** 当前状态下的待执行指令 */
  instruction?: string;
  /** 允许的迁移路径 */
  transitions: Array<{
    target: string;
    condition?: string; // 逻辑描述或简单的表达式
  }>;
  /** 重试策略（覆盖全局） */
  retryPolicy?: {
    maxAttempts: number;
    backoffFactor: number;
  };
}

/**
 * 状态机定义
 */
export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  initialState: string;
  states: Record<string, WorkflowState>;
}

/**
 * 状态机运行时快照 (Checkpoint)
 */
export interface WorkflowCheckpoint {
  runId: string;
  workflowId: string;
  /** Definition required to restore state transitions after process restart. */
  workflowDefinition?: WorkflowDefinition;
  sessionId: string;
  status: "running" | "paused" | "completed" | "failed" | "awaiting_approval";
  currentState: string;
  history: Array<{
    timestamp: number;
    fromState: string;
    toState: string;
    action?: string;
  }>;
  /** 上下文快照：保留执行到此处的关键消息 */
  contextSnapshot: Message[];
  /** 待处理的工具调用（若在执行中中断） */
  pendingToolCalls: ToolCall[];
  /** 已完成的工具结果（待提交给 LLM） */
  completedToolResults: ToolResult[];
  /** 错误堆栈（若失败） */
  error?: {
    message: string;
    stack?: string;
    stateId: string;
  };
  updatedAt: number;
}

/**
 * 状态机执行图的 DSL 构建器（辅助函数）
 */
export class WorkflowBuilder {
  private workflow: WorkflowDefinition;

  constructor(id: string, name: string) {
    this.workflow = {
      id,
      name,
      description: "",
      version: "1.0.0",
      initialState: "",
      states: {},
    };
  }

  setDescription(desc: string): this {
    this.workflow.description = desc;
    return this;
  }

  addState(state: WorkflowState): this {
    this.workflow.states[state.id] = state;
    if (!this.workflow.initialState) {
      this.workflow.initialState = state.id;
    }
    return this;
  }

  build(): WorkflowDefinition {
    return this.workflow;
  }
}
