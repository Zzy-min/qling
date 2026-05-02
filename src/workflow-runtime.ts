// ============================================================
// 轻灵 - Workflow Runtime (v0.3)
// 负责状态机执行、Checkpoint 落盘、崩溃恢复
// ============================================================

import * as fs from "fs/promises";
import * as path from "path";
import { existsSync } from "fs";
import { WorkflowDefinition, WorkflowCheckpoint, WorkflowState } from "./workflow-types.js";
import { Message, ToolCall, ToolResult } from "./types.js";

export class WorkflowRuntime {
  private checkpointDir: string;
  private currentCheckpoint: WorkflowCheckpoint | null = null;
  private workflow: WorkflowDefinition | null = null;

  constructor(checkpointDir: string) {
    this.checkpointDir = checkpointDir;
  }

  async init(): Promise<void> {
    if (!existsSync(this.checkpointDir)) {
      await fs.mkdir(this.checkpointDir, { recursive: true });
    }
  }

  /**
   * 开启一个新任务流
   */
  async start(workflow: WorkflowDefinition, sessionId: string, initialContext: Message[]): Promise<WorkflowCheckpoint> {
    this.workflow = workflow;
    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    
    this.currentCheckpoint = {
      runId,
      workflowId: workflow.id,
      sessionId,
      status: "running",
      currentState: workflow.initialState,
      history: [],
      contextSnapshot: initialContext,
      pendingToolCalls: [],
      completedToolResults: [],
      updatedAt: Date.now(),
    };

    await this.saveCheckpoint();
    return this.currentCheckpoint;
  }

  /**
   * 从 Checkpoint 恢复
   */
  async resume(runId: string): Promise<WorkflowCheckpoint> {
    const cpPath = this.getCheckpointPath(runId);
    if (!existsSync(cpPath)) {
      throw new Error(`Checkpoint not found for runId: ${runId}`);
    }

    const raw = await fs.readFile(cpPath, "utf-8");
    this.currentCheckpoint = JSON.parse(raw) as WorkflowCheckpoint;
    
    // TODO: 这里需要加载对应的 WorkflowDefinition（可能需要持久化存储定义）
    
    this.currentCheckpoint.status = "running";
    this.currentCheckpoint.updatedAt = Date.now();
    await this.saveCheckpoint();
    
    return this.currentCheckpoint;
  }

  /**
   * 状态迁移
   */
  async transitionTo(nextStateId: string, action?: string): Promise<void> {
    if (!this.currentCheckpoint || !this.workflow) return;

    const fromState = this.currentCheckpoint.currentState;
    this.currentCheckpoint.history.push({
      timestamp: Date.now(),
      fromState,
      toState: nextStateId,
      action,
    });

    this.currentCheckpoint.currentState = nextStateId;
    this.currentCheckpoint.updatedAt = Date.now();

    // 检查是否到达终点
    const stateDef = this.workflow.states[nextStateId];
    if (stateDef?.type === "end") {
      this.currentCheckpoint.status = "completed";
    }

    await this.saveCheckpoint();
  }

  /**
   * 更新上下文快照
   */
  async updateContext(messages: Message[]): Promise<void> {
    if (!this.currentCheckpoint) return;
    this.currentCheckpoint.contextSnapshot = messages;
    this.currentCheckpoint.updatedAt = Date.now();
    await this.saveCheckpoint();
  }

  /**
   * 记录待执行工具
   */
  async setPendingTools(toolCalls: ToolCall[]): Promise<void> {
    if (!this.currentCheckpoint) return;
    this.currentCheckpoint.pendingToolCalls = toolCalls;
    this.currentCheckpoint.updatedAt = Date.now();
    await this.saveCheckpoint();
  }

  /**
   * 记录已完成工具结果
   */
  async addToolResult(result: ToolResult): Promise<void> {
    if (!this.currentCheckpoint) return;
    this.currentCheckpoint.completedToolResults.push(result);
    this.currentCheckpoint.updatedAt = Date.now();
    await this.saveCheckpoint();
  }

  /**
   * 标记为等待审批
   */
  async awaitApproval(): Promise<void> {
    if (!this.currentCheckpoint) return;
    this.currentCheckpoint.status = "awaiting_approval";
    this.currentCheckpoint.updatedAt = Date.now();
    await this.saveCheckpoint();
  }

  /**
   * 标记执行失败
   */
  async fail(message: string, stack?: string): Promise<void> {
    if (!this.currentCheckpoint) return;
    this.currentCheckpoint.status = "failed";
    this.currentCheckpoint.error = {
      message,
      stack,
      stateId: this.currentCheckpoint.currentState,
    };
    this.currentCheckpoint.updatedAt = Date.now();
    await this.saveCheckpoint();
  }

  getCheckpoint(): WorkflowCheckpoint | null {
    return this.currentCheckpoint;
  }

  private async saveCheckpoint(): Promise<void> {
    if (!this.currentCheckpoint) return;
    const cpPath = this.getCheckpointPath(this.currentCheckpoint.runId);
    await fs.writeFile(cpPath, JSON.stringify(this.currentCheckpoint, null, 2), "utf-8");
  }

  private getCheckpointPath(runId: string): string {
    return path.join(this.checkpointDir, `${runId}.checkpoint.json`);
  }
}
