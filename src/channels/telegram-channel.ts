// ============================================================
// 轻灵 - Telegram Bot Channel（Telegram Bot 通道）
// axios + long-poll，无额外 SDK
// ============================================================

import axios from "axios";
import type { Channel, ApprovalRequest, ApprovalResponse } from "./types.js";

export interface TelegramChannelConfig {
  token: string;
  pollIntervalMs?: number;
  allowedChatIds?: string[];
}

export class TelegramChannel implements Channel {
  name = "telegram";
  private token: string;
  private pollIntervalMs: number;
  private allowedChatIds: number[];
  private baseUrl: string;
  private userMessageHandler: ((msg: string) => Promise<void>) | null = null;
  private running = false;
  private lastUpdateId = 0;
  private lastActiveChatId: number | null = null;
  private pendingApprovals = new Map<string, (response: ApprovalResponse) => void>();

  constructor(config: TelegramChannelConfig) {
    this.token = config.token;
    this.pollIntervalMs = config.pollIntervalMs ?? 3000;
    this.allowedChatIds = (config.allowedChatIds ?? []).map(Number);
    this.baseUrl = "https://api.telegram.org/bot" + this.token;
  }

  async start(): Promise<void> {
    if (!this.token) {
      console.error("[Telegram] No token configured");
      return;
    }
    this.running = true;
    this.pollLoop().catch(() => {});
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  async sendText(text: string): Promise<void> {
    const targets = this.resolveTargetChatIds();
    if (targets.length === 0) {
      console.error("[Telegram] sendText skipped: no target chat id");
      return;
    }
    const body = text.length > 4000 ? text.slice(0, 4000) + "\n... [truncated]" : text;
    for (const chatId of targets) {
      await axios.post(this.baseUrl + "/sendMessage", {
        chat_id: chatId,
        text: body,
      });
    }
  }

  async sendToolStart(toolName: string, args: Record<string, unknown>): Promise<void> {
    const preview = JSON.stringify(args).slice(0, 200);
    await this.sendText("[tool:start] " + toolName + "\n" + preview);
  }

  async sendToolResult(toolName: string, output: string, isError: boolean): Promise<void> {
    const status = isError ? "error" : "ok";
    await this.sendText("[tool:" + status + "] " + toolName + "\n" + output.slice(0, 500));
  }

  async sendError(text: string): Promise<void> {
    await this.sendText("[error] " + text);
  }

  onUserMessage(handler: (msg: string) => Promise<void>): void {
    this.userMessageHandler = handler;
  }

  async requestApproval(request: ApprovalRequest): Promise<ApprovalResponse> {
    const targets = this.resolveTargetChatIds();
    if (targets.length === 0) {
      return {
        requestId: request.id,
        decision: "deny",
        timestamp: Date.now(),
      };
    }

    const text =
      "[Approval Required]\n" +
      "Tool: " + request.toolName + "\n" +
      "Reason: " + request.reason + "\n" +
      "Approve this tool call?";

    return new Promise<ApprovalResponse>((resolve) => {
      this.pendingApprovals.set(request.id, resolve);
      const keyboard = {
        inline_keyboard: [
          [
            { text: "Allow", callback_data: request.id + ":allow" },
            { text: "Deny", callback_data: request.id + ":deny" },
          ],
        ],
      };

      Promise.all(
        targets.map((chatId) =>
          axios.post(this.baseUrl + "/sendMessage", {
            chat_id: chatId,
            text,
            reply_markup: keyboard,
          })
        )
      ).catch((err) => {
        console.error("[Telegram] Approval send failed: " + (err as Error).message);
      });
    });
  }

  handleCallbackQuery(callbackData: string, callbackQueryId: string): void {
    const match = /^(.*):(allow|deny)$/.exec(callbackData);
    if (!match) {
      axios
        .post(this.baseUrl + "/answerCallbackQuery", {
          callback_query_id: callbackQueryId,
          text: "Unsupported callback",
        })
        .catch(() => {});
      return;
    }
    const requestId = match[1];
    const decision = match[2];
    const resolver = this.pendingApprovals.get(requestId);
    if (resolver) {
      this.pendingApprovals.delete(requestId);
      resolver({
        requestId,
        decision: decision === "allow" ? "allow" : "deny",
        timestamp: Date.now(),
      });
    }
    // Acknowledge callback
    axios.post(this.baseUrl + "/answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text: "Processed",
    }).catch(() => {});
  }

  // --- Private ---

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const resp = await axios.post(this.baseUrl + "/getUpdates", {
          offset: this.lastUpdateId + 1,
          timeout: this.pollIntervalMs + 5000,
          allowed_updates: ["message", "callback_query"],
        }, { timeout: this.pollIntervalMs + 10000 });

        const updates = resp.data?.result ?? [];
        for (const update of updates) {
          if (update.update_id > this.lastUpdateId) {
            this.lastUpdateId = update.update_id;
          }
          if (update.message && this.userMessageHandler) {
            if (this.isAllowedChat(update.message.chat.id)) {
              this.lastActiveChatId = Number(update.message.chat.id);
              await this.userMessageHandler(update.message.text ?? "");
            }
          }
          if (update.callback_query) {
            this.handleCallbackQuery(
              update.callback_query.data ?? "",
              update.callback_query.id
            );
          }
        }
      } catch (err) {
        console.error("[Telegram] Poll error: " + (err as Error).message);
      }
      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
    }
  }

  private isAllowedChat(chatId: number): boolean {
    if (this.allowedChatIds.length === 0) return true;
    return this.allowedChatIds.includes(chatId);
  }

  private resolveTargetChatIds(): number[] {
    if (this.allowedChatIds.length > 0) {
      return [...this.allowedChatIds];
    }
    if (this.lastActiveChatId !== null) {
      return [this.lastActiveChatId];
    }
    return [];
  }
}
