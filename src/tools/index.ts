
// ============================================================
// 轻灵 - 工具调度器
// ============================================================

import { ToolCall, ToolResult, ToolDefinition } from "../types.js";
import { runBash, bashTool } from "./bash.js";
import { runRead, readTool } from "./read.js";
import { runWrite, writeTool } from "./write.js";
import { runTodo, todoTool } from "./todo.js";
import { runSkill, skillTool } from "./skill.js";
import { runSearch, searchTool } from "./search.js";
import { runPlanner, plannerTool } from "./planner.js";

export { bashTool, readTool, writeTool, todoTool, skillTool, searchTool, plannerTool };

export const ALL_TOOLS: ToolDefinition[] = [
  bashTool, readTool, writeTool, todoTool, skillTool, searchTool, plannerTool,
];

type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

const handlers: Record<string, ToolHandler> = {
  bash: runBash as ToolHandler,
  read: runRead as ToolHandler,
  write: runWrite as ToolHandler,
  todo: runTodo as ToolHandler,
  skill: runSkill as ToolHandler,
  search: runSearch as ToolHandler,
  planner: runPlanner as ToolHandler,
};

export async function dispatch(toolCall: ToolCall): Promise<ToolResult> {
  const handler = handlers[toolCall.name];
  if (!handler) {
    return {
      tool_call_id: toolCall.id,
      output: `Error: unknown tool '${toolCall.name}'`,
      is_error: true,
    };
  }
  try {
    const result = await handler(toolCall.arguments);
    return { tool_call_id: toolCall.id, output: result.output, is_error: result.is_error };
  } catch (err: unknown) {
    return {
      tool_call_id: toolCall.id,
      output: `Error: ${(err as Error).message}`,
      is_error: true,
    };
  }
}

export async function dispatchAll(toolCalls: ToolCall[]): Promise<ToolResult[]> {
  return Promise.all(toolCalls.map(dispatch));
}
