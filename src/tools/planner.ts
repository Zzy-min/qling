// ============================================================
// 轻灵 - s03 TodoWrite 规划注入
// 复杂任务自动进入规划模式：先 todo.add 列步骤，再逐个执行
// 格言：没有计划的 agent 走哪算哪，先列步骤再动手，完成率翻倍
// ============================================================

import { runTodo, todoTool } from "./todo.js";
import { ToolDefinition, ToolResult, ToolCall } from "../types.js";

// 规划模式下的 todo 工具：只允许 add，不允许其他操作
export const planTool: ToolDefinition = {
  ...todoTool,
  name: "plan",
  description:
    "计划工具。只在任务开始时使用，用于列出执行步骤。\n" +
    "用法：先用 plan add 依次添加所有步骤，再用 plan exec 开始执行。\n" +
    "注意：plan 模式下只能 add 和 list，不能 done/remove/clear。\n" +
    "示例：plan add \"第1步：确认需求\"",
};

interface PlanStep {
  id: string;
  content: string;
  status: "pending" | "done";
}

export class TodoPlanner {
  private steps: PlanStep[] = [];
  private planning = false;
  private executing = false;
  private currentStepIdx = 0;

  isPlanning(): boolean {
    return this.planning;
  }

  isExecuting(): boolean {
    return this.executing;
  }

  getCurrentStep(): PlanStep | null {
    if (!this.executing || this.currentStepIdx >= this.steps.length) return null;
    return this.steps[this.currentStepIdx];
  }

  // 处理 plan add
  async addStep(content: string): Promise<ToolResult> {
    const id = Date.now().toString(36);
    this.steps.push({ id, content, status: "pending" });
    return {
      tool_call_id: "",
      output: `📋 已添加步骤 [${id}]: ${content}`,
    };
  }

  // 处理 plan exec，开始执行模式
  startExecution(): void {
    this.executing = true;
    this.currentStepIdx = 0;
  }

  // 标记当前步骤完成，进入下一步
  advanceStep(): void {
    if (this.currentStepIdx < this.steps.length) {
      this.steps[this.currentStepIdx].status = "done";
      this.currentStepIdx++;
    }
  }

  isDone(): boolean {
    return this.executing && this.currentStepIdx >= this.steps.length;
  }

  getPlanSummary(): string {
    if (this.steps.length === 0) return "";
    const lines = this.steps.map((s, i) => {
      const icon = s.status === "done" ? "✅" : i === this.currentStepIdx ? "🔄" : "⬜";
      return `${icon} ${i + 1}. ${s.content}`;
    });
    return `\n📋 执行计划:\n${lines.join("\n")}\n`;
  }

  reset(): void {
    this.steps = [];
    this.planning = false;
    this.executing = false;
    this.currentStepIdx = 0;
  }
}
