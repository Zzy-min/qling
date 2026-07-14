// ============================================================
// 轻灵 - Approval Gate（审批流）
// Promise 暂停机制 + 超时自动拒绝
// ============================================================

import type { ApprovalRequest, ApprovalResponse } from "../types.js";

export class ApprovalGate {
  private pending = new Map<
    string,
    {
      resolve: (response: ApprovalResponse) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  async requestApproval(
    request: ApprovalRequest,
    channel: { requestApproval: (req: ApprovalRequest) => Promise<ApprovalResponse> },
    timeoutMs: number = 300_000
  ): Promise<ApprovalResponse> {
    return new Promise<ApprovalResponse>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.has(request.id)) {
          this.pending.delete(request.id);
          resolve({
            requestId: request.id,
            decision: "deny",
            timestamp: Date.now(),
          });
          console.error("[Approval] Timeout auto-denied: " + request.id);
        }
      }, timeoutMs);

      this.pending.set(request.id, { resolve, timer });

      channel.requestApproval(request).then((response) => {
        const pending = this.pending.get(request.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(request.id);
          resolve(response);
        }
      }).catch(() => {
        const pending = this.pending.get(request.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(request.id);
          resolve({
            requestId: request.id,
            decision: "deny",
            timestamp: Date.now(),
          });
        }
      });
    });
  }

  getPendingCount(): number {
    return this.pending.size;
  }

  cancelAll(): void {
    for (const [id, { resolve, timer }] of this.pending) {
      clearTimeout(timer);
      resolve({
        requestId: id,
        decision: "deny",
        timestamp: Date.now(),
      });
    }
    this.pending.clear();
  }
}

export class ApprovalRequiredError extends Error {
  toolCallId: string;
  toolName: string;
  reasons: string[];

  constructor(toolCallId: string, toolName: string, reasons: string[]) {
    super("approval_required");
    this.name = "ApprovalRequiredError";
    this.toolCallId = toolCallId;
    this.toolName = toolName;
    this.reasons = reasons;
  }
}
