// ============================================================
// 轻灵 - MCP 客户端（transport 抽象）
// 支持 stdio 和 HTTP (Streamable) transport
// ============================================================

import type { MCPServerConfig, MCPToolDefinition, MCPConnectResult, MCPMessage } from "./types.js";
import type { ToolResult } from "../types.js";
import { StdioTransport } from "./stdio-transport.js";
import { HttpTransport } from "./http-transport.js";

interface MCPTransport {
  send(msg: MCPMessage): void | Promise<void>;
  onMessage(handler: (msg: MCPMessage) => void): void;
  onError(handler: (err: Error) => void): void;
  onClose(handler: () => void): void;
  close(): Promise<void>;
}

export class MCPClient {
  private config: MCPServerConfig;
  private transport: MCPTransport | null = null;
  private msgId = 0;
  private pending = new Map<string | number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private connected = false;
  private tools: MCPToolDefinition[] = [];
  private connectionTimeout: number;
  private callTimeout: number;

  constructor(config: MCPServerConfig, timeouts?: { connection?: number; call?: number }) {
    this.config = config;
    this.connectionTimeout = timeouts?.connection ?? 10_000;
    this.callTimeout = timeouts?.call ?? 30_000;
  }

  async connect(): Promise<MCPConnectResult> {
    try {
      const transportType = this.config.transport ?? "stdio";

      if (transportType === "http") {
        if (!this.config.url) {
          return { serverName: this.config.name, tools: [], status: "failed", error: "HTTP transport requires url" };
        }
        this.transport = new HttpTransport(
          this.config.url,
          this.config.headers,
          this.callTimeout,
        );
      } else {
        const stdio = new StdioTransport(
          this.config.command,
          this.config.args,
          this.config.env,
        );
        // Wait for spawn
        await Promise.race([
          stdio.ready(),
          new Promise<void>((_, reject) => setTimeout(() => reject(new Error("spawn timeout")), this.connectionTimeout)),
        ]);

        if (!stdio.isAlive()) {
          return { serverName: this.config.name, tools: [], status: "failed", error: "Failed to spawn process" };
        }
        this.transport = stdio;
      }

      // Wire up message/error/close handlers
      this.transport.onMessage((msg) => this.handleMessage(msg));
      this.transport.onError((err) => {
        this.connected = false;
        for (const [id, { reject }] of this.pending) {
          reject(err);
          this.pending.delete(id);
        }
      });
      this.transport.onClose(() => {
        this.connected = false;
        for (const [id, { reject }] of this.pending) {
          reject(new Error("MCP transport closed"));
          this.pending.delete(id);
        }
      });

      // 1. initialize
      const initResult = await this.sendRequest("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "qingling", version: "0.2" },
      });

      if (!initResult) {
        return { serverName: this.config.name, tools: [], status: "failed", error: "initialize failed: no response" };
      }

      // 2. initialized notification
      await this.sendNotification("notifications/initialized");

      // 3. tools/list
      const toolsResult = await this.sendRequest("tools/list", {});
      if (toolsResult && typeof toolsResult === "object" && "tools" in toolsResult) {
        const rawTools = (toolsResult as { tools: unknown[] }).tools;
        this.tools = rawTools.map((t: any) => ({
          serverName: this.config.name,
          name: t.name,
          description: t.description ?? "",
          inputSchema: t.inputSchema ?? {},
        }));
      }

      this.connected = true;
      return { serverName: this.config.name, tools: this.tools, status: "connected" };
    } catch (err) {
      return {
        serverName: this.config.name,
        tools: [],
        status: "failed",
        error: (err as Error).message,
      };
    }
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (!this.connected || !this.transport) {
      return {
        tool_call_id: "mcp_" + name,
        output: "[MCP Error] Server " + this.config.name + " not connected",
        is_error: true,
      };
    }

    try {
      const result = await this.sendRequest("tools/call", { name, arguments: args });
      if (!result) {
        return {
          tool_call_id: "mcp_" + name,
          output: "[MCP Error] No response from " + this.config.name,
          is_error: true,
        };
      }

      const r = result as any;
      if (r.isError) {
        const errorText = r.error?.message ?? r.content?.[0]?.text ?? JSON.stringify(r);
        return {
          tool_call_id: "mcp_" + name,
          output: "[MCP Error] " + errorText,
          is_error: true,
        };
      }

      const texts = r.content
        ?.filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("\n") ?? JSON.stringify(r);

      return {
        tool_call_id: "mcp_" + name,
        output: texts,
        is_error: false,
      };
    } catch (err) {
      return {
        tool_call_id: "mcp_" + name,
        output: "[MCP Error] " + (err as Error).message,
        is_error: true,
      };
    }
  }

  async disconnect(): Promise<void> {
    if (this.transport) {
      try {
        await this.sendNotification("shutdown");
        await new Promise((r) => setTimeout(r, 500));
      } catch {
        // ignore
      }
      await this.transport.close();
      this.transport = null;
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  getServerName(): string {
    return this.config.name;
  }

  getTools(): MCPToolDefinition[] {
    return [...this.tools];
  }

  // --- Private ---

  private handleMessage(msg: MCPMessage): void {
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) {
        reject(new Error("MCP error: " + msg.error.message));
      } else {
        resolve(msg.result);
      }
    }
  }

  private sendRequest(method: string, params: unknown, timeout?: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      const msg: MCPMessage = { jsonrpc: "2.0", id, method, params };
      this.pending.set(id, { resolve, reject });

      try {
        const result = this.transport!.send(msg);
        // If transport.send returns a promise (HTTP), handle errors
        if (result && typeof (result as Promise<void>).catch === "function") {
          (result as Promise<void>).catch((err) => {
            if (this.pending.has(id)) {
              this.pending.delete(id);
              reject(err);
            }
          });
        }
      } catch (err) {
        this.pending.delete(id);
        reject(err);
        return;
      }

      const ms = timeout ?? (method === "initialize" ? this.connectionTimeout : this.callTimeout);
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error("MCP request timeout: " + method));
        }
      }, ms);
    });
  }

  private async sendNotification(method: string, params?: unknown): Promise<void> {
    if (!this.transport) return;
    const msg: MCPMessage = { jsonrpc: "2.0", method, params };
    await this.transport.send(msg);
  }
}
