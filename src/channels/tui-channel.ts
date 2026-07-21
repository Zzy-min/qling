// ============================================================
// 轻灵 - TUI Channel（chat 模式审批入口）
// 对标 Grok Build interactive permission prompt + plan approval bar
// ============================================================

import type { Channel, ApprovalRequest, ApprovalResponse } from "./types.js";

/** StreamUI 暴露给 Channel 的最小审批端口 */
export interface TuiApprovalPort {
  requestToolApproval(request: ApprovalRequest): Promise<ApprovalResponse>;
}

/**
 * chat / StreamingREPL 专用通道。
 * 工具 ask 时通过 TUI 选项面板收集 allow/deny，不再依赖 Console readline。
 */
export class TuiChannel implements Channel {
  readonly name = "tui";

  constructor(private readonly port: TuiApprovalPort) {}

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async sendText(_text: string): Promise<void> {}
  async sendToolStart(_toolName: string, _args: Record<string, unknown>): Promise<void> {}
  async sendToolResult(_toolName: string, _output: string, _isError: boolean): Promise<void> {}
  async sendError(_text: string): Promise<void> {}
  onUserMessage(_handler: (msg: string) => Promise<void>): void {}

  async requestApproval(request: ApprovalRequest): Promise<ApprovalResponse> {
    return this.port.requestToolApproval(request);
  }
}
