// ============================================================
// 轻灵 - Channel 接口
// ============================================================

export interface ChannelMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface ApprovalRequest {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
  reason: string;
  timestamp: number;
}

export interface ApprovalResponse {
  requestId: string;
  decision: "allow" | "deny";
  timestamp: number;
}

export interface Channel {
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  sendText(text: string): Promise<void>;
  sendToolStart(toolName: string, args: Record<string, unknown>): Promise<void>;
  sendToolResult(toolName: string, output: string, isError: boolean): Promise<void>;
  sendError(text: string): Promise<void>;
  onUserMessage(handler: (msg: string) => Promise<void>): void;
  requestApproval(request: ApprovalRequest): Promise<ApprovalResponse>;
}
