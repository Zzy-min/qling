// ============================================================
// 轻灵 - Subtask 工具定义
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
import { getRuntimeRootsFromEnv } from "../runtime-paths.js";

export const subtaskTool: ToolDefinition = {
  name: "subtask",
  description: "Spawn an isolated sub-agent for an independent subtask. The sub-agent has its own context but shares memory with the parent.",
  parameters: {
    type: "object",
    properties: {
      task: {
        type: "string",
        description: "The subtask description",
      },
      context: {
        type: "string",
        description: "Additional context to pass to the sub-agent",
      },
      max_iterations: {
        type: "number",
        description: "Max iterations (default 10)",
      },
    },
    required: ["task"],
  },
  readOnly: false,
  destructive: false,
  scenes: ["planning"],
  effortHint: "high",
};

export async function runSubtask(args: {
  task: string;
  context?: string;
  max_iterations?: number;
  timeout_ms?: number;
}): Promise<ToolResult> {
  const task = String(args.task ?? "").trim();
  if (!task) {
    return toolError("SUBTASK_MISSING_TASK", "task is required");
  }

  const apiKey =
    process.env.QINGLING_LLM_API_KEY ??
    process.env.DEEPSEEK_API_KEY ??
    process.env.OPENAI_API_KEY ??
    "";
  if (!apiKey) {
    return toolError("SUBTASK_MISSING_API_KEY", "missing API key for subtask agent");
  }

  const maxIterationsRaw = Number(args.max_iterations ?? 10);
  const maxIterations =
    Number.isFinite(maxIterationsRaw) && maxIterationsRaw > 0
      ? Math.min(50, Math.max(1, Math.floor(maxIterationsRaw)))
      : 10;
  const timeoutRaw = Number(args.timeout_ms ?? 120_000);
  const timeoutMs =
    Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? Math.min(600_000, timeoutRaw) : 120_000;
  const roots = getRuntimeRootsFromEnv();

  const runner = new SubtaskRunner({
    apiKey,
    provider: process.env.QINGLING_LLM_PROVIDER ?? "deepseek",
    endpoint:
      process.env.QINGLING_LLM_ENDPOINT ??
      process.env.OPENAI_BASE_URL ??
      process.env.DEEPSEEK_BASE_URL ??
      "https://api.deepseek.com",
    model: process.env.QINGLING_LLM_MODEL ?? "deepseek-chat",
    tools: [
      bashTool,
      readTool,
      writeTool,
      todoTool,
      skillTool,
      searchTool,
      plannerTool,
      urlFetchTool,
    ],
    runtime: {
      workspaceDir: roots.workspaceDir,
      fileCacheDir: roots.fileCacheDir,
      fileStateDir: roots.fileStateDir,
      maxSteps: maxIterations,
      parseRetries: 2,
      maxTokenBudget: 120_000,
      toolRepeatLimit: 6,
      timeoutMs,
    },
    logging: {
      level: "info",
      format: "text",
      inspectPrompt: false,
      inspectRequest: false,
      inspectDumpDir: roots.fileStateDir,
    },
  });

  try {
    const result = await runner.run({
      task,
      parentContext: args.context,
      maxIterations,
      depth: 1,
      timeoutMs,
    });
    if (!result.success) {
      return toolError("SUBTASK_FAILED", result.output, { retriable: false, category: "runtime" });
    }
    return toolSuccess(
      [
        `subtask completed in ${result.durationMs}ms`,
        `iterations=${result.iterations}`,
        "",
        result.output,
      ].join("\n")
    );
  } catch (err) {
    return toolError("SUBTASK_RUN_FAILED", err instanceof Error ? err.message : String(err), {
      retriable: false,
      category: "runtime",
    });
  }
}
