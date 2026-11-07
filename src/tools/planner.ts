import {
  createStructuredTaskPlan,
  formatTaskPlanMarkdown,
  loadWorkspaceTaskPlan,
  replanStructuredTaskPlan,
  saveWorkspaceTaskPlan,
  summarizeTaskPlan,
  updatePlanStepStatus,
  withWorkspacePlanLock,
  type TaskPlanStepInput,
  type TaskPlanStepStatus,
} from "../plan/task-plan.js";
import { getRuntimeRootsFromEnv, resolveEffectiveWorkspace } from "../runtime-paths.js";
import { ToolDefinition, ToolResult } from "../types.js";
import { toolError } from "./error-utils.js";

export const plannerTool: ToolDefinition = {
  name: "planner",
  description:
    "任务规划与动态重规划工具。支持创建可执行结构化计划（含子任务、依赖、所需工具、预期产出、验收标准、失败恢复策略）、更新步骤验证状态及在失败时动态重规划（保留已完成步骤）。",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["create", "update_step", "update", "replan", "get", "status", "verify", "verify_step"],
        description: "操作类型（默认 create）",
      },
      goal: {
        type: "string",
        description: "需要规划的总体目标（create 时必填）",
      },
      context: {
        type: "string",
        description: "已知的背景信息、约束条件或动态重规划的原因",
      },
      steps: {
        type: "array",
        description: "结构化子任务步骤列表（create 或 replan 时传入；若省略则根据目标自动拆解）",
        items: {
          anyOf: [
            { type: "string" },
            {
              type: "object",
              properties: {
                id: { type: "string" },
                title: { type: "string" },
                dependsOn: { type: "array", items: { type: "string" } },
                requiredTools: { type: "array", items: { type: "string" } },
                expectedOutput: { type: "string" },
                acceptanceCriteria: { type: "string" },
                recoveryStrategy: { type: "string" },
              },
              required: ["title"],
            },
          ],
        },
      },
      stepId: {
        type: "string",
        description: "要更新的子任务步骤 ID（update_step 时必填）",
      },
      status: {
        type: "string",
        enum: ["pending", "in_progress", "verifying", "completed", "failed", "skipped", "blocked"],
        description: "子任务状态（update_step 时必填）",
      },
      verificationEvidence: {
        type: "string",
        description: "步骤完成时的验证证据摘要（update_step 时可选）",
      },
      failureReason: {
        type: "string",
        description: "步骤失败原因或重规划触发原因",
      },
    },
    required: [],
  },
  readOnly: false,
  destructive: false,
  concurrencySafe: false,
  effortHint: "low",
  scenes: ["planning", "coding", "data", "system"],
  priority: 7,
};

function generateDefaultStepsForGoal(goal: string): TaskPlanStepInput[] {
  const lower = goal.toLowerCase();

  if (lower.includes("重构") || lower.includes("refactor") || lower.includes("修复") || lower.includes("fix")) {
    return [
      {
        id: "step-1",
        title: "探索与定位：检索相关源码、理解现有逻辑与调用关系",
        dependsOn: [],
        requiredTools: ["search", "read", "repo_query"],
        expectedOutput: "明确问题根因及受影响的文件与符号列表",
        acceptanceCriteria: "完成目标文件读取并确认修改位置",
        recoveryStrategy: "若关键字搜索无结果，切换为 glob 或 repo_map 扩大范围",
      },
      {
        id: "step-2",
        title: "制定与实施变更：按最小改动原则修改目标代码文件",
        dependsOn: ["step-1"],
        requiredTools: ["patch", "patch_anchored", "write"],
        expectedOutput: "目标源文件完成修改且无语法错误",
        acceptanceCriteria: "文件修改成功落盘并通过基础语法校验",
        recoveryStrategy: "若 patch 失败，改用 read_anchored + patch_anchored 精确编辑",
      },
      {
        id: "step-3",
        title: "执行验证与回归测试：运行单元测试或验证命令确认目标达成",
        dependsOn: ["step-2"],
        requiredTools: ["verify", "bash"],
        expectedOutput: "相关测试与构建检查通过（exit code 0）",
        acceptanceCriteria: "确定性测试命令通过，无新增回归失败",
        recoveryStrategy: "若测试失败，根据错误堆栈定位原因并回退或修正 step-2",
      },
    ];
  }

  if (lower.includes("分析") || lower.includes("报告") || lower.includes("统计") || lower.includes("调研")) {
    return [
      {
        id: "step-1",
        title: "收集数据与上下文：读取目标数据源或检索相关信息",
        dependsOn: [],
        requiredTools: ["read", "search", "bash"],
        expectedOutput: "获取完整、可验证的原始数据或文档摘录",
        acceptanceCriteria: "数据源读取成功且内容非空",
        recoveryStrategy: "若路径不存在，先用 search 或 ls 查找正确路径",
      },
      {
        id: "step-2",
        title: "处理与交叉核验：执行统计计算或事实一致性校验",
        dependsOn: ["step-1"],
        requiredTools: ["bash", "read"],
        expectedOutput: "经过验证的统计结果与核心结论",
        acceptanceCriteria: "计算逻辑无异常且结论有明确数据支撑",
        recoveryStrategy: "对异常值或缺失字段做显式容错处理",
      },
      {
        id: "step-3",
        title: "生成结构化交付物：输出或保存最终分析报告并核验完整性",
        dependsOn: ["step-2"],
        requiredTools: ["write", "read"],
        expectedOutput: "结构化分析报告或目标输出文件",
        acceptanceCriteria: "涵盖所有用户问题且关键结论附带证据来源",
        recoveryStrategy: "若文件写入失败，检查目录权限与路径格式",
      },
    ];
  }

  return [
    {
      id: "step-1",
      title: "理解任务与收集上下文：确认输入条件、环境状态与目标文件",
      dependsOn: [],
      requiredTools: ["read", "search"],
      expectedOutput: "明确任务前置条件与操作目标",
      acceptanceCriteria: "获取执行所需的全部上下文信息",
      recoveryStrategy: "若信息不足，扩大检索范围或向用户请求澄清",
    },
    {
      id: "step-2",
      title: "执行核心任务操作：调用所需工具完成目标产出",
      dependsOn: ["step-1"],
      requiredTools: ["write", "patch", "bash"],
      expectedOutput: "完成核心交付物生成或系统变更",
      acceptanceCriteria: "工具调用返回成功且目标状态符合预期",
      recoveryStrategy: "捕获工具错误码并切换替代工具或修正参数",
    },
    {
      id: "step-3",
      title: "结果验证与收尾检查：核验产出完整性与验收标准",
      dependsOn: ["step-2"],
      requiredTools: ["read", "verify", "bash"],
      expectedOutput: "验证通过的最终结果与完成证据",
      acceptanceCriteria: "所有交付物存在、格式正确且满足用户约束",
      recoveryStrategy: "发现未达标项时针对性补齐后再结束",
    },
  ];
}

export async function runPlanner(args: {
  action?: "create" | "update_step" | "update" | "replan" | "get" | "status" | "verify" | "verify_step";
  goal?: string;
  objective?: string;
  context?: string;
  steps?: (TaskPlanStepInput | string)[];
  stepId?: string;
  status?: TaskPlanStepStatus;
  verificationEvidence?: string;
  failureReason?: string;
  workspaceDir?: string;
  __qling_workspace_dir?: string;
}): Promise<ToolResult> {
  const rawWorkspace = args.workspaceDir ?? args.__qling_workspace_dir;
  const workspaceDir =
    rawWorkspace && rawWorkspace.trim()
      ? rawWorkspace
      : resolveEffectiveWorkspace(getRuntimeRootsFromEnv());
  const action = args.action ?? "create";
  const goalText = (args.goal ?? args.objective ?? "").trim();

  try {
    return await withWorkspacePlanLock(workspaceDir, () => {
      if (action === "get" || action === "status") {
        const existing = loadWorkspaceTaskPlan(workspaceDir);
        if (!existing) {
          return {
            tool_call_id: "",
            output: "📋 当前工作区尚无激活的结构化任务计划。",
          };
        }
        return {
          tool_call_id: "",
          output: formatTaskPlanMarkdown(existing),
        };
      }

      if (action === "update_step" || action === "update") {
        const existing = loadWorkspaceTaskPlan(workspaceDir);
        if (!existing) {
          return toolError(
            "PLANNER_NO_ACTIVE_PLAN",
            "No active task plan found in workspace. Call planner with action='create' first.",
            { category: "validation" }
          );
        }
        if (!args.stepId || !args.status) {
          return toolError(
            "PLANNER_MISSING_STEP_UPDATE",
            "Missing 'stepId' or 'status' for planner update_step action.",
            { category: "validation" }
          );
        }
        const updated = updatePlanStepStatus(existing, args.stepId, {
          status: args.status,
          verificationEvidence: args.verificationEvidence,
          failureReason: args.failureReason,
        });
        saveWorkspaceTaskPlan(workspaceDir, updated);
        const summary = summarizeTaskPlan(updated);
        return {
          tool_call_id: "",
          output: [
            `✅ 已更新计划步骤 [${args.stepId}] -> ${args.status}`,
            `当前计划进度: ${summary.completedSteps}/${summary.totalSteps} 已完成 (状态: ${summary.status})`,
            `下一步可执行步骤: ${summary.readyStepIds.join(", ") || "无"}`,
          ].join("\n"),
        };
      }

      if (action === "verify" || action === "verify_step") {
        const existing = loadWorkspaceTaskPlan(workspaceDir);
        if (!existing) {
          return toolError(
            "PLANNER_NO_ACTIVE_PLAN",
            "No active task plan found in workspace. Call planner with action='create' first.",
            { category: "validation" }
          );
        }
        if (args.stepId) {
          const targetStatus: TaskPlanStepStatus = args.status ?? "completed";
          const updated = updatePlanStepStatus(existing, args.stepId, {
            status: targetStatus,
            verificationEvidence: args.verificationEvidence ?? "verified via planner",
            failureReason: args.failureReason,
          });
          saveWorkspaceTaskPlan(workspaceDir, updated);
          const summary = summarizeTaskPlan(updated);
          return {
            tool_call_id: "",
            output: [
              `✅ 已验证计划步骤 [${args.stepId}] -> ${targetStatus}`,
              `当前计划进度: ${summary.completedSteps}/${summary.totalSteps} 已完成 (已验证 ${summary.verifiedSteps} 步, 状态: ${summary.status})`,
              `下一步可执行步骤: ${summary.readyStepIds.join(", ") || "无"}`,
            ].join("\n"),
          };
        }
        const summary = summarizeTaskPlan(existing);
        return {
          tool_call_id: "",
          output: [
            `🔍 计划验证状态: ${summary.status} (${summary.completedSteps}/${summary.totalSteps} 已完成, 已绑定证据 ${summary.verifiedSteps} 步)`,
            summary.unmetStepIds.length > 0
              ? `未完成步骤: ${summary.unmetStepIds.join(", ")}`
              : "所有计划步骤已完成。",
          ].join("\n"),
        };
      }

      if (action === "replan") {
        const existing = loadWorkspaceTaskPlan(workspaceDir);
        if (!existing) {
          return toolError(
            "PLANNER_NO_ACTIVE_PLAN",
            "No active task plan found to replan. Call planner with action='create' first.",
            { category: "validation" }
          );
        }
        const reason = args.failureReason ?? args.context ?? "执行受阻触发动态重规划";
        const newSteps =
          Array.isArray(args.steps) && args.steps.length > 0
            ? args.steps
            : generateDefaultStepsForGoal(existing.objective);
        const replanned = replanStructuredTaskPlan(existing, {
          reason,
          newSteps,
          ...(goalText ? { objective: goalText } : {}),
        });
        saveWorkspaceTaskPlan(workspaceDir, replanned);
        return {
          tool_call_id: "",
          output: [
            `🔄 已完成动态重规划 (第 ${replanned.replanCount} 次重规划，已完成验证步骤已保留)`,
            "",
            formatTaskPlanMarkdown(replanned),
          ].join("\n"),
        };
      }

      if (action !== "create") {
        return toolError(
          "PLANNER_UNKNOWN_ACTION",
          `Unknown planner action '${String(action)}'.`,
          { category: "validation" }
        );
      }

      // Default: action === "create"
      if (!goalText) {
        return toolError(
          "PLANNER_MISSING_GOAL",
          "Missing 'goal' for planner tool. Provide the high-level goal to break down.",
          { category: "validation" }
        );
      }

      const stepInputs =
        Array.isArray(args.steps) && args.steps.length > 0
          ? args.steps
          : generateDefaultStepsForGoal(goalText);
      const plan = createStructuredTaskPlan({
        objective: goalText,
        steps: stepInputs,
      });
      saveWorkspaceTaskPlan(workspaceDir, plan);

      return {
        tool_call_id: "",
        output: [
          `📋 任务规划已生成并绑定至运行时 (${plan.planId})`,
          args.context ? `背景与约束: ${args.context}` : "",
          "",
          formatTaskPlanMarkdown(plan),
        ]
          .filter(Boolean)
          .join("\n"),
      };
    });
  } catch (error) {
    return toolError(
      "PLANNER_EXECUTION_ERROR",
      error instanceof Error ? error.message : String(error),
      { category: "validation" }
    );
  }
}
