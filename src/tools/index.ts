
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
import { runBrowserFetch, browserFetchTool } from "./browser-fetch.js";
import { runBrowserAct, browserActTool } from "./browser-act.js";
import { runCodeSymbols, codeSymbolsTool } from "./code-symbols.js";
import { runLsp, lspTool } from "./lsp.js";
import { runPatch, patchTool } from "./patch.js";
import {
  bgKillTool,
  bgListTool,
  bgWaitTool,
  runBgKill,
  runBgList,
  runBgWait,
} from "./bg-task.js";
import { toolError } from "./error-utils.js";
import { isMCPTool, parseMCPToolName } from "../mcp/bridge.js";
import type { MCPRegistry } from "../mcp/registry.js";
import {
  runSearchToolCatalog,
  runUseCatalogTool,
  searchToolCatalogTool,
  useCatalogTool,
} from "./mcp-catalog.js";
import {
  patchAnchoredTool,
  readAnchoredTool,
  runPatchAnchored,
  runReadAnchored,
} from "./anchored-edit.js";

export {
  bashTool,
  readTool,
  writeTool,
  todoTool,
  skillTool,
  searchTool,
  plannerTool,
  urlFetchTool,
  subtaskTool,
  visionAnalyzeTool,
  browserFetchTool,
  browserActTool,
  codeSymbolsTool,
  lspTool,
  patchTool,
  bgListTool,
  bgWaitTool,
  bgKillTool,
  searchToolCatalogTool,
  useCatalogTool,
  readAnchoredTool,
  patchAnchoredTool,
};

export const ALL_TOOLS: ToolDefinition[] = [
  bashTool,
  readTool,
  writeTool,
  todoTool,
  skillTool,
  searchTool,
  plannerTool,
  urlFetchTool,
  subtaskTool,
  visionAnalyzeTool,
  browserFetchTool,
  browserActTool,
  codeSymbolsTool,
  lspTool,
  patchTool,
  bgListTool,
  bgWaitTool,
  bgKillTool,
];

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
  browser_fetch: runBrowserFetch as ToolHandler,
  browser_act: runBrowserAct as ToolHandler,
  code_symbols: runCodeSymbols as ToolHandler,
  lsp: runLsp as ToolHandler,
  patch: runPatch as ToolHandler,
  bg_list: runBgList as ToolHandler,
  bg_wait: runBgWait as ToolHandler,
  bg_kill: runBgKill as ToolHandler,
  search_tool: runSearchToolCatalog as ToolHandler,
  use_tool: runUseCatalogTool as ToolHandler,
  read_anchored: runReadAnchored as ToolHandler,
  patch_anchored: runPatchAnchored as ToolHandler,
};

export type ToolDispatcher = (toolCall: ToolCall) => Promise<ToolResult>;

export interface ToolDispatcherOptions {
  mcpRegistry?: MCPRegistry | null | (() => MCPRegistry | null);
}

export function createToolDispatcher(options: ToolDispatcherOptions = {}): ToolDispatcher {
  const resolveRegistry = () => typeof options.mcpRegistry === "function"
    ? options.mcpRegistry()
    : options.mcpRegistry ?? null;
  return async (toolCall: ToolCall): Promise<ToolResult> => {
    const registry = resolveRegistry();
    // MCP tool routing is bound to this dispatcher instance.
    if (isMCPTool(toolCall.name) && registry) {
      const parsed = parseMCPToolName(toolCall.name);
      if (parsed) {
        const result = await registry.callTool(parsed.serverName, parsed.toolName, toolCall.arguments);
        return { ...result, tool_call_id: toolCall.id };
      }
    }

    if (toolCall.name === "search_tool") {
      const result = await runSearchToolCatalog(toolCall.arguments, registry);
      return { ...result, tool_call_id: toolCall.id };
    }
    if (toolCall.name === "use_tool") {
      const result = await runUseCatalogTool(toolCall.arguments, registry);
      return { ...result, tool_call_id: toolCall.id };
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
  };
}

const defaultDispatcher = createToolDispatcher();

export async function dispatch(toolCall: ToolCall): Promise<ToolResult> {
  return defaultDispatcher(toolCall);
}

export async function dispatchAll(toolCalls: ToolCall[]): Promise<ToolResult[]> {
  return Promise.all(toolCalls.map(dispatch));
}
