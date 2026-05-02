
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
import { runUrlFetch, urlFetchTool } from "./url-fetch.js";
import { runSubtask, subtaskTool } from "./subtask.js";
import { runVisionAnalyze, visionAnalyzeTool } from "./vision-analyze.js";
import { toolError } from "./error-utils.js";
import { isMCPTool, parseMCPToolName } from "../mcp/bridge.js";
import type { MCPRegistry } from "../mcp/registry.js";

export { bashTool, readTool, writeTool, todoTool, skillTool, searchTool, plannerTool, urlFetchTool, visionAnalyzeTool };
export { subtaskTool } from "./subtask.js";

export const ALL_TOOLS: ToolDefinition[] = [
  bashTool, readTool, writeTool, todoTool, skillTool, searchTool, plannerTool, urlFetchTool, subtaskTool, visionAnalyzeTool,
];

// Runtime MCP registry reference
let mcpRegistry: MCPRegistry | null = null;

export function setMCPRegistry(registry: MCPRegistry): void {
  mcpRegistry = registry;
}

export function getMCPRegistry(): MCPRegistry | null {
  return mcpRegistry;
}

export interface ToolRegistryBuildOptions {
  staticEnabled?: Record<string, boolean>;
  runtimeInjected?: ToolDefinition[];
  channelContextual?: ToolDefinition[];
}

export function buildToolRegistry(options: ToolRegistryBuildOptions = {}): ToolDefinition[] {
  const staticEnabled = options.staticEnabled ?? {};
  const staticLayer = ALL_TOOLS.filter((t) => staticEnabled[t.name] !== false);
  const merged = [...staticLayer, ...(options.runtimeInjected ?? []), ...(options.channelContextual ?? [])];

  const byName = new Map<string, ToolDefinition>();
  for (const tool of merged) {
    byName.set(tool.name, tool);
  }
  return Array.from(byName.values());
}

type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

const handlers: Record<string, ToolHandler> = {
  bash: runBash as ToolHandler,
  read: runRead as ToolHandler,
  write: runWrite as ToolHandler,
  todo: runTodo as ToolHandler,
  skill: runSkill as ToolHandler,
  search: runSearch as ToolHandler,
  planner: runPlanner as ToolHandler,
  url_fetch: runUrlFetch as ToolHandler,
  subtask: runSubtask as ToolHandler,
  vision_analyze: runVisionAnalyze as ToolHandler,
};

export async function dispatch(toolCall: ToolCall): Promise<ToolResult> {
  // MCP tool routing
  if (isMCPTool(toolCall.name) && mcpRegistry) {
    const parsed = parseMCPToolName(toolCall.name);
    if (parsed) {
      const result = await mcpRegistry.callTool(parsed.serverName, parsed.toolName, toolCall.arguments);
      return { ...result, tool_call_id: toolCall.id };
    }
  }

  const handler = handlers[toolCall.name];
  if (!handler) {
    return { ...toolError("TOOL_NOT_FOUND", `unknown tool '${toolCall.name}'`), tool_call_id: toolCall.id };
  }
  try {
    const result = await handler(toolCall.arguments);
    return {
      ...result,
      tool_call_id: toolCall.id,
    };
  } catch (err: unknown) {
    return {
      ...toolError("TOOL_DISPATCH_FAILED", err instanceof Error ? err.message : String(err), {
        retriable: false,
        category: "runtime",
      }),
      tool_call_id: toolCall.id,
    };
  }
}

export async function dispatchAll(toolCalls: ToolCall[]): Promise<ToolResult[]> {
  return Promise.all(toolCalls.map(dispatch));
}
