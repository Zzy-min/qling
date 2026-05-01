// ============================================================
// 轻灵 - MCP 工具桥接
// 将 MCP 工具转换为原生 ToolDefinition 格式
// ============================================================

import type { MCPToolDefinition, MCPServerConfig } from "./types.js";
import type { ToolDefinition } from "../types.js";

const MCP_PREFIX = "mcp__";
const MCP_SEPARATOR = "__";

export function mcpToolFullName(serverName: string, toolName: string): string {
  return MCP_PREFIX + serverName + MCP_SEPARATOR + toolName;
}

export function isMCPTool(toolName: string): boolean {
  return toolName.startsWith(MCP_PREFIX);
}

export function parseMCPToolName(toolName: string): { serverName: string; toolName: string } | null {
  if (!isMCPTool(toolName)) return null;
  const withoutPrefix = toolName.slice(MCP_PREFIX.length);
  const idx = withoutPrefix.indexOf(MCP_SEPARATOR);
  if (idx === -1) return null;
  return {
    serverName: withoutPrefix.slice(0, idx),
    toolName: withoutPrefix.slice(idx + MCP_SEPARATOR.length),
  };
}

export function mcpToolsToNativeDefinitions(mcpTools: MCPToolDefinition[]): ToolDefinition[] {
  return mcpTools.map((t) => ({
    name: mcpToolFullName(t.serverName, t.name),
    description: "[MCP:" + t.serverName + "] " + t.description,
    parameters: t.inputSchema as Record<string, unknown>,
    readOnly: true,
    scenes: ["mcp"],
    priority: 4,
  }));
}

export function buildMCPServersFromConfig(config: Record<string, MCPServerConfig>): MCPServerConfig[] {
  return Object.values(config).filter((s) => s.enabled);
}
