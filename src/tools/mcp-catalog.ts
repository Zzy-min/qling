import type { ToolDefinition, ToolResult } from "../types.js";
import { getMCPRegistry } from "./index.js";
import { toolError, toolSuccess } from "./error-utils.js";

export const searchToolCatalogTool: ToolDefinition = {
  name: "search_tool",
  description: "Search the connected local MCP tool catalog. Returns callable names and schemas without injecting every MCP schema into the prompt.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Capability or tool name to search for" },
      limit: { type: "number", description: "Maximum matches, default 5" },
    },
    required: ["query"],
  },
  readOnly: true,
  scenes: ["mcp"],
  priority: 8,
};

export const useCatalogTool: ToolDefinition = {
  name: "use_tool",
  description: "Call a tool returned by search_tool. The name must be a visible mcp__server__tool catalog result.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Qualified name returned by search_tool" },
      arguments: { type: "object", description: "Arguments matching the returned schema" },
    },
    required: ["name", "arguments"],
  },
  readOnly: false,
  scenes: ["mcp"],
  priority: 8,
};

export const MCP_CATALOG_TOOLS = [searchToolCatalogTool, useCatalogTool];

export async function runSearchToolCatalog(args: Record<string, unknown>): Promise<ToolResult> {
  const registry = getMCPRegistry();
  if (!registry) return toolError("MCP_CATALOG_UNAVAILABLE", "MCP registry is not initialized");
  const query = String(args.query ?? "").trim();
  if (!query) return toolError("MCP_CATALOG_INVALID_QUERY", "query is required");
  const limit = Number(args.limit ?? 5);
  const matches = registry.searchTools(query, Number.isFinite(limit) ? limit : 5);
  return toolSuccess(JSON.stringify({ query, matches }, null, 2));
}

export async function runUseCatalogTool(args: Record<string, unknown>): Promise<ToolResult> {
  const registry = getMCPRegistry();
  if (!registry) return toolError("MCP_CATALOG_UNAVAILABLE", "MCP registry is not initialized");
  const name = String(args.name ?? "").trim();
  const found = registry.getCatalogTool(name);
  if (!found) {
    return toolError("MCP_CATALOG_TOOL_NOT_VISIBLE", `tool '${name}' was not found in the visible catalog`);
  }
  const toolArgs = args.arguments;
  if (!toolArgs || typeof toolArgs !== "object" || Array.isArray(toolArgs)) {
    return toolError("MCP_CATALOG_INVALID_ARGUMENTS", "arguments must be an object");
  }
  return registry.callTool(found.serverName, found.name, toolArgs as Record<string, unknown>);
}
