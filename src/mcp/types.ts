// ============================================================
// 轻灵 - MCP 协议类型
// ============================================================

export interface MCPServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled: boolean;
  transport?: "stdio" | "http";
  url?: string;
  headers?: Record<string, string>;
}

export interface MCPToolDefinition {
  serverName: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPConnectResult {
  serverName: string;
  tools: MCPToolDefinition[];
  status: "connected" | "failed";
  error?: string;
}

export interface MCPMessage {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface MCPMCPConfig {
  servers: Record<string, MCPServerConfig>;
  connection_timeout_ms: number;
  call_timeout_ms: number;
}
