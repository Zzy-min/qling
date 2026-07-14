// ============================================================
// 轻灵 - Channel 接口
// ============================================================

export type { ApprovalRequest, ApprovalResponse } from "../types.js";
import type { ApprovalRequest, ApprovalResponse } from "../types.js";

export interface ChannelMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
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
