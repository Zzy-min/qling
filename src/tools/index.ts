
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
import {
  deepseekFetchTool,
  deepseekSearchTool,
  runDeepseekFetch,
  runDeepseekSearch,
} from "./deepseek-web.js";
import { runSubtask, subtaskTool } from "./subtask.js";
import { runVisionAnalyze, visionAnalyzeTool } from "./vision-analyze.js";
import { runBrowserFetch, browserFetchTool } from "./browser-fetch.js";
import { runBrowserAct, browserActTool } from "./browser-act.js";
import { runCodeSymbols, codeSymbolsTool } from "./code-symbols.js";
import { runLsp, lspTool } from "./lsp.js";
import { runPatch, patchTool } from "./patch.js";
import {
  impactAnalysisTool,
  repoMapTool,
  repoQueryTool,
  runImpactAnalysis,
  runRepoMap,
  runRepoQuery,
} from "./repo-intelligence.js";
import {
  bgKillTool,
  bgListTool,
  bgReconcileTool,
  bgWaitTool,
  runBgKill,
  runBgList,
  runBgReconcile,
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
import { ToolCapabilityRegistry, classifyToolInvocation } from "../harness/tool-capability.js";
import { runBoundedToolBatch } from "./scheduler.js";
import { runVerify, verifyTool } from "./verify.js";
import { computerUseTool } from "../computer-use/schema.js";
import { ComputerUseController } from "../computer-use/controller.js";
import { CuaMcpDriver } from "../computer-use/driver.js";
import { getRuntimeExecutionIdentity, getRuntimeRootsFromEnv } from "../runtime-paths.js";

export const toolSearchTool: ToolDefinition = {
  name: "tool_search",
  description: "Search the local capability catalog with BM25 and return relevant tool names and usage schemas.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
      limit: { type: "number" },
    },
    required: ["query"],
  },
  readOnly: true,
  destructive: false,
  concurrencySafe: true,
  scenes: ["discovery"],
  effortHint: "low",
};

export {
  bashTool,
  readTool,
  writeTool,
  todoTool,
  skillTool,
  searchTool,
  plannerTool,
  urlFetchTool,
  deepseekSearchTool,
  deepseekFetchTool,
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
  bgReconcileTool,
  searchToolCatalogTool,
  useCatalogTool,
  readAnchoredTool,
  patchAnchoredTool,
  repoMapTool,
  repoQueryTool,
  impactAnalysisTool,
  verifyTool,
  computerUseTool,
};

export const ALL_TOOLS: ToolDefinition[] = [
  computerUseTool,
  bashTool,
  readTool,
  writeTool,
  todoTool,
  skillTool,
  searchTool,
  plannerTool,
  urlFetchTool,
  deepseekSearchTool,
  deepseekFetchTool,
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
  bgReconcileTool,
  repoMapTool,
  repoQueryTool,
  impactAnalysisTool,
  verifyTool,
  toolSearchTool,
];

export interface ToolRegistryBuildOptions {
  staticEnabled?: Record<string, boolean>;
  allowedNames?: ReadonlySet<string>;
  runtimeInjected?: ToolDefinition[];
  channelContextual?: ToolDefinition[];
}

export function buildToolRegistry(options: ToolRegistryBuildOptions = {}): ToolDefinition[] {
  const staticEnabled = options.staticEnabled ?? {};
  const allowedNames = options.allowedNames;
  const isAllowed = (name: string) => !allowedNames || allowedNames.has(name);
  const staticLayer = ALL_TOOLS.filter((t) => staticEnabled[t.name] !== false && isAllowed(t.name) &&
    (t.name !== "computer_use" || /^(1|true|yes|on)$/i.test(process.env.QLING_FEATURES_COMPUTER_USE ?? "")));
  const merged = [...staticLayer, ...(options.runtimeInjected ?? []), ...(options.channelContextual ?? [])];

  const byName = new Map<string, ToolDefinition>();
  for (const tool of merged) {
    if (isAllowed(tool.name)) byName.set(tool.name, tool);
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
  deepseek_search: runDeepseekSearch as ToolHandler,
  deepseek_fetch: runDeepseekFetch as ToolHandler,
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
  bg_reconcile: runBgReconcile as ToolHandler,
  search_tool: runSearchToolCatalog as ToolHandler,
  use_tool: runUseCatalogTool as ToolHandler,
  read_anchored: runReadAnchored as ToolHandler,
  patch_anchored: runPatchAnchored as ToolHandler,
  repo_map: runRepoMap as ToolHandler,
  repo_query: runRepoQuery as ToolHandler,
  impact_analysis: runImpactAnalysis as ToolHandler,
  verify: runVerify as unknown as ToolHandler,
};

export type ToolDispatcher = ((toolCall: ToolCall) => Promise<ToolResult>) & { close?: () => Promise<void> };

export interface ToolDispatcherOptions {
  mcpRegistry?: MCPRegistry | null | (() => MCPRegistry | null);
  allowedNames?: ReadonlySet<string>;
  computerUse?: Pick<ComputerUseController, "execute" | "close">;
  computerUseConfig?: { enabled: boolean; driverPath: string; stateDir: string };
  signal?: () => AbortSignal | undefined;
}

export function createToolDispatcher(options: ToolDispatcherOptions = {}): ToolDispatcher {
  const config = options.computerUseConfig ?? {
    enabled: /^(1|true|yes|on)$/i.test(process.env.QLING_FEATURES_COMPUTER_USE ?? ""),
    driverPath: process.env.QLING_COMPUTER_USE_DRIVER_PATH ?? "",
    stateDir: getRuntimeRootsFromEnv().fileStateDir,
  };
  const computerUse = options.computerUse ?? new ComputerUseController({
    enabled: config.enabled, stateDir: config.stateDir,
    driver: new CuaMcpDriver({ command: config.driverPath }),
    identity: () => { const owner = getRuntimeExecutionIdentity(); return `${owner.sessionId ?? "local"}:${owner.runId ?? "local"}`; },
  });
  const resolveRegistry = () => typeof options.mcpRegistry === "function"
    ? options.mcpRegistry()
    : options.mcpRegistry ?? null;
  const dispatch: ToolDispatcher = async (toolCall: ToolCall): Promise<ToolResult> => {
    if (options.allowedNames && !options.allowedNames.has(toolCall.name)) {
      return {
        ...toolError("TOOL_NOT_ALLOWED", `tool '${toolCall.name}' is not allowed in this session`, {
          retriable: false,
          category: "permission",
        }),
        tool_call_id: toolCall.id,
      };
    }
    if (toolCall.name === "computer_use") {
      return { ...await computerUse.execute(toolCall.arguments, options.signal?.()), tool_call_id: toolCall.id };
    }
    const registry = resolveRegistry();
    // MCP tool routing is bound to this dispatcher instance.
    if (isMCPTool(toolCall.name) && registry) {
      const parsed = parseMCPToolName(toolCall.name);
      if (parsed) {
        try {
          const result = await registry.callTool(parsed.serverName, parsed.toolName, toolCall.arguments, options.signal?.());
          return { ...result, tool_call_id: toolCall.id };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          const canceled = /aborted|cancell?ed/i.test(message);
          return {
            ...toolError(canceled ? "TOOL_CANCELED" : "TOOL_DISPATCH_FAILED", message, {
              retriable: false,
              category: "runtime",
            }),
            tool_call_id: toolCall.id,
          };
        }
      }
    }
    if (toolCall.name === "tool_search") {
      const query = String(toolCall.arguments.query ?? "").trim();
      if (!query) return { ...toolError("TOOL_SEARCH_INVALID", "query is required"), tool_call_id: toolCall.id };
      const limit = Math.max(1, Math.min(20, Number(toolCall.arguments.limit ?? 8)));
      const matches = new ToolCapabilityRegistry(buildToolRegistry()).search(query, limit);
      return {
        tool_call_id: toolCall.id,
        output: matches.map((tool) => `${tool.name}: ${tool.description}\nschema: ${JSON.stringify(tool.parameters)}`).join("\n\n") || "(no matching tools)",
        is_error: false,
      };
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
      // Root selection is host-owned. Built-ins resolve their workspace from RuntimeServices' scope.
      const { workspaceDir: _workspace, __qling_workspace_dir: _internalWorkspace, ...args } = toolCall.arguments;
      const result = await handler(args);
      return {
        ...result,
        tool_call_id: toolCall.id,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const canceled = /aborted|cancell?ed/i.test(message);
      return {
        ...toolError(canceled ? "TOOL_CANCELED" : "TOOL_DISPATCH_FAILED", message, {
          retriable: false,
          category: "runtime",
        }),
        tool_call_id: toolCall.id,
      };
    }
  };
  dispatch.close = () => computerUse.close();
  return dispatch;
}

const defaultDispatcher = createToolDispatcher();

export async function dispatch(toolCall: ToolCall): Promise<ToolResult> {
  return defaultDispatcher(toolCall);
}

export async function dispatchAll(toolCalls: ToolCall[]): Promise<ToolResult[]> {
  const items = toolCalls.map((call) => {
    const capability = classifyToolInvocation({
      name: call.name,
      arguments: call.arguments,
    });
    return {
      value: call,
      readOnly: Boolean(capability.readOnly),
      concurrencySafe: capability.concurrencyPolicy === "parallel",
      sideEffect: capability.sideEffect,
    };
  });
  return runBoundedToolBatch(items, (call) => dispatch(call));
}
