// ============================================================
// 轻灵 - Subtask 工具定义（Phase 3.2 角色化 + 并行 explore）
// ============================================================

import type { ToolDefinition, ToolResult } from "../types.js";
import { SubtaskRunner } from "../agent/subtask.js";
import { toolError, toolSuccess } from "./error-utils.js";
import { bashTool } from "./bash.js";
import { readTool } from "./read.js";
import { writeTool } from "./write.js";
import { todoTool } from "./todo.js";
import { skillTool } from "./skill.js";
import { searchTool } from "./search.js";
import { plannerTool } from "./planner.js";
import { urlFetchTool } from "./url-fetch.js";
import { patchTool } from "./patch.js";
import { codeSymbolsTool } from "./code-symbols.js";
import { lspTool } from "./lsp.js";
import { getRuntimeRootsFromEnv } from "../runtime-paths.js";
import {
  filterToolsForRole,
  isKnownSubAgentRole,
  normalizeSubAgentRole,
  type SubAgentRole,
} from "../agents/roles.js";
import {
  formatParallelExploreReport,
  gateParallelExplore,
  isSubtaskParallelEnabled,
  parseParallelTasks,
} from "../agent/subtask-parallel.js";
import { loadRoleCatalog } from "../agents/role-loader.js";
import { UsageLedger } from "../usage-ledger.js";
import { randomUUID } from "node:crypto";
import { getSubagentCoordinator, type SubtaskSpec } from "../agents/coordinator.js";
import { SubagentWorktreeManager } from "../agents/worktree-manager.js";
import { isRelativePathOwned, normalizeOwnedPaths } from "../agents/ownership.js";

const SUBTASK_TOOL_POOL = [
  bashTool,
  readTool,
  writeTool,
  patchTool,
  todoTool,
  skillTool,
  searchTool,
  codeSymbolsTool,
  lspTool,
  plannerTool,
  urlFetchTool,
];

export const subtaskTool: ToolDefinition = {
  name: "subtask",
  description:
    "Spawn isolated sub-agent(s). role=explore|implement|review. Optional tasks[] runs parallel read-only explores when QLING_SUBTASK_PARALLEL=1.",
  longDescription: `派生子代理执行独立子任务。

**角色 role**:
- explore — 只读探索
- implement — 实现（可写）
- review — 只读审查

**并行**（默认关）:
- 设 QLING_SUBTASK_PARALLEL=1
- 传 tasks=["任务A","任务B"]（2–3 个，仅 explore/review）
- 写操作禁止并行

**回传**: 【子代理回传契约】；并行时为【并行探索回传】汇总。
**禁止嵌套**: 子代理不可再 subtask。`,
  parameters: {
    type: "object",
    properties: {
      task: {
        type: "string",
        description: "Single subtask (required unless tasks[] is set)",
      },
      tasks: {
        type: "array",
        description:
          "Parallel explore/review task list (requires QLING_SUBTASK_PARALLEL=1). Max 3 by default.",
        items: { type: "string" },
      },
      context: {
        type: "string",
        description: "Additional context to pass to the sub-agent",
      },
      role: {
        type: "string",
        description: "explore | implement | review (default implement; parallel defaults explore)",
      },
      max_iterations: {
        type: "number",
        description: "Max iterations (default 10)",
      },
      owned_paths: {
        type: "array",
        description: "Files or directories exclusively owned by an implement subtask in controlled mode",
        items: { type: "string" },
      },
    },
    required: [],
  },
  readOnly: false,
  destructive: false,
  scenes: ["planning"],
  effortHint: "high",
};

function buildRunnerConfig(
  role: SubAgentRole,
  maxIterations: number,
  timeoutMs: number,
  workspaceDir?: string,
  ownedPaths?: string[]
) {
  const roots = getRuntimeRootsFromEnv();
  const controlledToolNames = new Set(["read", "search", "code_symbols", "lsp", "skill", "write", "patch"]);
  const tools = filterToolsForRole(SUBTASK_TOOL_POOL, role)
    .filter((tool) => !(ownedPaths && ownedPaths.length > 0) || controlledToolNames.has(tool.name));
  const apiKey =
    process.env.QLING_LLM_API_KEY ??
    process.env.DEEPSEEK_API_KEY ??
    process.env.OPENAI_API_KEY ??
    "";

  return {
    apiKey,
    tools,
    parent: {
      apiKey,
      provider: process.env.QLING_LLM_PROVIDER ?? "deepseek",
      endpoint:
        process.env.QLING_LLM_ENDPOINT ??
        process.env.OPENAI_BASE_URL ??
        process.env.DEEPSEEK_BASE_URL ??
        "https://api.deepseek.com",
      model: process.env.QLING_LLM_MODEL ?? "deepseek-chat",
      tools,
      runtime: {
        workspaceDir: workspaceDir ?? roots.workspaceDir,
        fileCacheDir: roots.fileCacheDir,
        fileStateDir: roots.fileStateDir,
        maxSteps: maxIterations,
        parseRetries: 2,
        toolRepeatLimit: 6,
        timeoutMs,
        ...(ownedPaths && ownedPaths.length > 0 ? { ownedPaths } : {}),
      },
      logging: {
        level: "info" as const,
        format: "text" as const,
        inspectPrompt: false,
        inspectRequest: false,
        inspectDumpDir: roots.fileStateDir,
      },
    },
  };
}

export async function runSubtask(args: {
  task?: string;
  tasks?: unknown;
  context?: string;
  role?: string;
  max_iterations?: number;
  timeout_ms?: number;
  owned_paths?: unknown;
}): Promise<ToolResult> {
  const parallelTasks = parseParallelTasks(args.tasks);
  const singleTask = String(args.task ?? "").trim();
  const rootsForRoles = getRuntimeRootsFromEnv();
  const roleCatalog = await loadRoleCatalog({
    workspaceDir: rootsForRoles.workspaceDir ?? undefined,
    stateDir: rootsForRoles.fileStateDir,
  });
  const requestedRole = String(args.role ?? (parallelTasks.length > 0 ? "explore" : "implement")).trim().toLowerCase();
  const loadedRole = roleCatalog.get(requestedRole);

  if (parallelTasks.length === 0 && !singleTask) {
    return toolError(
      "SUBTASK_MISSING_TASK",
      "task is required (or tasks[] for parallel explore)"
    );
  }

  if (args.role !== undefined && args.role !== "" && !loadedRole && !isKnownSubAgentRole(args.role)) {
    return toolError(
      "SUBTASK_INVALID_ROLE",
      `unknown role "${args.role}"; use explore | implement | review`
    );
  }

  const maxIterationsRaw = Number(args.max_iterations ?? 10);
  const maxIterations =
    Number.isFinite(maxIterationsRaw) && maxIterationsRaw > 0
      ? Math.min(50, Math.max(1, Math.floor(maxIterationsRaw)))
      : 10;
  const timeoutRaw = Number(args.timeout_ms ?? 120_000);
  const timeoutMs =
    Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? Math.min(600_000, timeoutRaw) : 120_000;

  // --- 并行路径 ---
  if (parallelTasks.length > 0) {
    // 若同时给了 task，并入列表
    const tasks =
      singleTask && !parallelTasks.includes(singleTask)
        ? [singleTask, ...parallelTasks]
        : parallelTasks.length > 0
          ? parallelTasks
          : [singleTask];

    const roleHint = loadedRole?.baseRole ?? (args.role !== undefined && args.role !== "" ? args.role : "explore");
    const gate = gateParallelExplore({
      tasks,
      role: roleHint,
      enabled: isSubtaskParallelEnabled(),
    });
    if (!gate.ok) {
      return toolError(gate.errorCode ?? "SUBTASK_PARALLEL_DENIED", gate.errorMessage ?? "denied");
    }

    const { apiKey, tools, parent } = buildRunnerConfig(gate.role, maxIterations, timeoutMs);
    if (!apiKey) {
      return toolError("SUBTASK_MISSING_API_KEY", "missing API key for subtask agent");
    }

    try {
      const settled = await Promise.all(
        gate.tasks.map(async (task) => {
          const runner = new SubtaskRunner(parent);
          const result = await runner.run({
            task,
            parentContext: args.context,
            maxIterations,
            depth: 1,
            timeoutMs,
            role: gate.role,
            tools,
          });
          return { task, result };
        })
      );
      const report = formatParallelExploreReport(settled);
      const anyFail = settled.some((s) => !s.result.success);
      const usageLedger = new UsageLedger();
      for (const item of settled) {
        if (item.result.usage) usageLedger.merge(item.result.usage);
        else usageLedger.markIncomplete("subagent_usage_missing");
        if (item.result.usageIsIncomplete) usageLedger.markIncomplete("subagent_usage_incomplete");
      }
      const usageSnapshot = usageLedger.snapshot();
      if (anyFail) {
        return {
          ...toolError("SUBTASK_PARALLEL_PARTIAL", report, {
          retriable: false,
          category: "runtime",
          }),
          meta: { usageSnapshot, usageIsIncomplete: usageSnapshot.usageIsIncomplete },
        };
      }
      return {
        ...toolSuccess(report),
        meta: { usageSnapshot, usageIsIncomplete: usageSnapshot.usageIsIncomplete },
      };
    } catch (err) {
      return toolError(
        "SUBTASK_PARALLEL_FAILED",
        err instanceof Error ? err.message : String(err),
        { retriable: false, category: "runtime" }
      );
    }
  }

  // --- 单任务路径 ---
  const role = loadedRole?.baseRole ?? normalizeSubAgentRole(args.role);
  const controlled = process.env.QLING_FEATURES_CONTROLLED_SUBAGENTS === "true";
  let ownedPaths = Array.isArray(args.owned_paths)
    ? args.owned_paths.map(String).map((value) => value.trim()).filter(Boolean)
    : [];
  const taskId = `subtask-${randomUUID()}`;
  const coordinator = getSubagentCoordinator();
  let worktreePath: string | undefined;
  let worktreeBranch: string | undefined;
  let registered = false;

  if (controlled && role === "implement") {
    if (ownedPaths.length === 0) {
      return toolError("SUBTASK_OWNERSHIP_REQUIRED", "controlled implement subtasks require owned_paths");
    }
    try {
      ownedPaths = normalizeOwnedPaths(ownedPaths);
    } catch (error) {
      return toolError("SUBTASK_INVALID_OWNERSHIP", error instanceof Error ? error.message : String(error));
    }
    const roots = getRuntimeRootsFromEnv();
    const spec: SubtaskSpec = {
      id: taskId,
      objective: singleTask,
      returnContract: "summary, evidence, files changed, validation, unresolved risks",
      role,
      readOnly: false,
      ownedPaths,
      workspaceMode: "worktree",
      budget: { wallClockMs: timeoutMs, tokens: maxIterations * 8_000, toolCalls: maxIterations * 6 },
      allowedCommunication: [],
      cancellation: "cascade",
      acceptance: ["changes remain within owned paths", "return evidence and validation results"],
    };
    try {
      coordinator.register(spec);
      registered = true;
      const worktree = await new SubagentWorktreeManager({ stateDir: roots.fileStateDir }).create({
        taskId,
        workspaceDir: roots.workspaceDir ?? process.cwd(),
      });
      worktreePath = worktree.path;
      worktreeBranch = worktree.branch;
      coordinator.start(taskId);
    } catch (error) {
      if (registered) coordinator.fail(taskId, error instanceof Error ? error.message : String(error));
      return toolError("SUBTASK_ISOLATION_FAILED", error instanceof Error ? error.message : String(error), {
        retriable: false,
        category: "runtime",
      });
    }
  }

  const { apiKey, tools, parent } = buildRunnerConfig(
    role,
    maxIterations,
    timeoutMs,
    worktreePath,
    registered ? ownedPaths : undefined
  );
  if (!apiKey) {
    if (registered) coordinator.fail(taskId, "missing API key");
    return toolError("SUBTASK_MISSING_API_KEY", "missing API key for subtask agent");
  }

  const runner = new SubtaskRunner(parent);

  try {
    const result = await runner.run({
      task: singleTask,
      parentContext: [loadedRole?.prompt, args.context].filter(Boolean).join("\n\n") || undefined,
      maxIterations,
      depth: 1,
      timeoutMs,
      role,
      tools,
    });
    if (!result.success) {
      if (registered) coordinator.fail(taskId, result.contractText || result.output);
      return toolError("SUBTASK_FAILED", result.contractText || result.output, {
        retriable: false,
        category: "runtime",
      });
    }
    if (registered && worktreePath) {
      const changed = await new SubagentWorktreeManager({ stateDir: getRuntimeRootsFromEnv().fileStateDir })
        .listChangedFiles(worktreePath);
      const outside = changed.filter((file) => !isRelativePathOwned(file, ownedPaths));
      if (outside.length > 0) {
        coordinator.fail(taskId, `changes outside ownership: ${outside.join(", ")}`);
        return toolError("SUBTASK_OWNERSHIP_VIOLATION", `subtask changed files outside owned_paths: ${outside.join(", ")}`, {
          retriable: false,
          category: "permission",
        });
      }
    }
    if (registered) coordinator.complete(taskId);
    return {
      ...toolSuccess(result.contractText || result.output),
      meta: {
        usageSnapshot: result.usage,
        usageIsIncomplete: result.usageIsIncomplete,
        ...(result.backgroundTaskId ? { backgroundTaskId: result.backgroundTaskId } : {}),
        ...(registered ? { taskId, worktreePath, worktreeBranch, ownedPaths } : {}),
      },
    };
  } catch (err) {
    if (registered) coordinator.fail(taskId, err instanceof Error ? err.message : String(err));
    return toolError("SUBTASK_RUN_FAILED", err instanceof Error ? err.message : String(err), {
      retriable: false,
      category: "runtime",
    });
  }
}
