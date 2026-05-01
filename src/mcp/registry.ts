// ============================================================
// 轻灵 - MCP 服务器注册表（生命周期管理）
// ============================================================

import { MCPClient } from "./client.js";
import type { MCPServerConfig, MCPToolDefinition, MCPConnectResult } from "./types.js";
import type { ToolResult } from "../types.js";

export class MCPRegistry {
  private clients = new Map<string, MCPClient>();
  private connectionTimeout: number;
  private callTimeout: number;

  constructor(timeouts?: { connection?: number; call?: number }) {
    this.connectionTimeout = timeouts?.connection ?? 10_000;
    this.callTimeout = timeouts?.call ?? 30_000;
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
    return all;
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
    return client.callTool(toolName, args);
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
}
