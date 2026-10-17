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
  connection_timeout_ms?: number;
  call_timeout_ms?: number;
  /** per-server 输出上限（字节），优先于 QLING_MCP_MAX_OUTPUT_BYTES。 */
  max_output_bytes?: number;
}

export interface MCPToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
}

export interface MCPToolDefinition {
  serverName: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: MCPToolAnnotations;
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
