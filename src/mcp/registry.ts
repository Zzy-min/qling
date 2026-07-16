// ============================================================
// 轻灵 - MCP 服务器注册表（生命周期管理）
// ============================================================

import { MCPClient } from "./client.js";
import type { MCPServerConfig, MCPToolDefinition, MCPConnectResult } from "./types.js";
import type { ToolResult } from "../types.js";
import { ToolCatalog, type ToolCatalogMatch } from "./tool-catalog.js";

export class MCPRegistry {
  private clients = new Map<string, MCPClient>();
  private connectionTimeout: number;
  private callTimeout: number;
  private maxOutputBytes: number;
  private catalog = new ToolCatalog();

  constructor(timeouts?: { connection?: number; call?: number; maxOutputBytes?: number }) {
    this.connectionTimeout = timeouts?.connection ?? 10_000;
    this.callTimeout = timeouts?.call ?? 30_000;
    this.maxOutputBytes = Math.max(1024, timeouts?.maxOutputBytes ?? 20 * 1024);
  }

  registerServer(config: MCPServerConfig): void {
    const client = new MCPClient(config, {
      connection: this.connectionTimeout,
      call: this.callTimeout,
    });
    this.clients.set(config.name, client);
  }

  async connectAll(): Promise<MCPConnectResult[]> {
    const results: MCPConnectResult[] = [];
    for (const [name, client] of this.clients) {
      if (!client.isConnected()) {
        const result = await client.connect();
        results.push(result);
      }
    }
    return results;
  }

  async connectServer(name: string): Promise<MCPConnectResult> {
    const client = this.clients.get(name);
    if (!client) {
      return { serverName: name, tools: [], status: "failed", error: "Server not registered" };
    }
    return client.connect();
  }

  async disconnectAll(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.disconnect();
    }
  }

  async disconnectServer(name: string): Promise<void> {
    const client = this.clients.get(name);
    if (client) await client.disconnect();
  }

  getAllTools(): MCPToolDefinition[] {
    const all: MCPToolDefinition[] = [];
    for (const client of this.clients.values()) {
      if (client.isConnected()) {
        all.push(...client.getTools());
      }
    }
    this.catalog.replace(all);
    return all;
  }

  searchTools(query: string, limit = 5): ToolCatalogMatch[] {
    this.catalog.replace(this.collectTools());
    return this.catalog.search(query, limit);
  }

  getCatalogTool(fullName: string): MCPToolDefinition | undefined {
    this.catalog.replace(this.collectTools());
    return this.catalog.get(fullName);
  }

  async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    const client = this.clients.get(serverName);
    if (!client || !client.isConnected()) {
      return {
        tool_call_id: "mcp_" + serverName + "__" + toolName,
        output: "[MCP Error] Server " + serverName + " not connected",
        is_error: true,
      };
    }
    const result = await client.callTool(toolName, args);
    return truncateMcpResult(result, this.maxOutputBytes);
  }

  getConnectedServers(): string[] {
    const names: string[] = [];
    for (const [name, client] of this.clients) {
      if (client.isConnected()) names.push(name);
    }
    return names;
  }

  getStatus(): Record<string, "connected" | "disconnected"> {
    const status: Record<string, "connected" | "disconnected"> = {};
    for (const [name, client] of this.clients) {
      status[name] = client.isConnected() ? "connected" : "disconnected";
    }
    return status;
  }

  getClient(serverName: string): MCPClient | undefined {
    return this.clients.get(serverName);
  }

  private collectTools(): MCPToolDefinition[] {
    const all: MCPToolDefinition[] = [];
    for (const client of this.clients.values()) {
      if (client.isConnected()) all.push(...client.getTools());
    }
    return all;
  }
}

export function truncateMcpResult(result: ToolResult, maxBytes = 20 * 1024): ToolResult {
  const originalBytes = Buffer.byteLength(result.output, "utf8");
  if (originalBytes <= maxBytes) return result;
  const suffix = "\n…[MCP output truncated by byte budget]";
  const bodyBudget = Math.max(0, maxBytes - Buffer.byteLength(suffix, "utf8"));
  let body = Buffer.from(result.output, "utf8").subarray(0, bodyBudget).toString("utf8");
  while (Buffer.byteLength(body, "utf8") > bodyBudget) body = body.slice(0, -1);
  return {
    ...result,
    output: body + suffix,
    meta: {
      ...(result.meta ?? {}),
      truncated: true,
      originalBytes,
      returnedBytes: Buffer.byteLength(body + suffix, "utf8"),
      maxBytes,
    },
  };
}
