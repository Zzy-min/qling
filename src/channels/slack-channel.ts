// ============================================================
// 轻灵 - Slack Bot Channel（Slack Bot 通道）
// axios + Web API polling，无 SDK 依赖
// ============================================================

import axios from "axios";
import type { Channel, ApprovalRequest, ApprovalResponse } from "./types.js";

export interface SlackChannelConfig {
  botToken: string;
  appToken?: string;
  channelIds?: string[];
  pollIntervalMs?: number;
}

export class SlackChannel implements Channel {
  name = "slack";
  private botToken: string;
  private channelIds: string[];
  private pollIntervalMs: number;
  private userMessageHandler: ((msg: string) => Promise<void>) | null = null;
  private running = false;
  private lastTs = new Map<string, string>();
  private lastActiveChannelId: string | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pendingApprovals = new Map<
    string,
    {
      requestId: string;
      resolve: (response: ApprovalResponse) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(config: SlackChannelConfig) {
    this.botToken = config.botToken;
    this.channelIds = config.channelIds ?? [];
    this.pollIntervalMs = config.pollIntervalMs ?? 3000;
  }

  async start(): Promise<void> {
    if (!this.botToken) {
      console.error("[Slack] No bot token configured");
      return;
    }
    this.running = true;

    if (this.channelIds.length === 0) {
      await this.discoverChannels();
    }

    this.pollTimer = setInterval(() => {
      this.pollAllChannels().catch((err) => {
        console.error("[Slack] Poll error: " + (err as Error).message);
      });
    }, this.pollIntervalMs);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    for (const [shortId, pending] of this.pendingApprovals) {
      clearTimeout(pending.timer);
      pending.resolve({ requestId: pending.requestId, decision: "deny", timestamp: Date.now() });
      this.pendingApprovals.delete(shortId);
    }
  }

  async sendText(text: string): Promise<void> {
    const targets = this.resolveTargetChannelIds();
    if (targets.length === 0) {
      console.error("[Slack] sendText skipped: no target channel");
      return;
    }
    const body = text.length > 3000 ? text.slice(0, 3000) + "\n... [truncated]" : text;
    for (const channelId of targets) {
      try {
        await this.apiCall("chat.postMessage", {
          channel: channelId,
          text: body,
        });
      } catch (err) {
        console.error("[Slack] sendText failed: " + (err as Error).message);
      }
    }
  }

  async sendToolStart(toolName: string, args: Record<string, unknown>): Promise<void> {
    const preview = JSON.stringify(args).slice(0, 200);
    await this.sendText("[tool:start] " + toolName + "\n```" + preview + "```");
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
    const targets = this.resolveTargetChannelIds();
    if (targets.length === 0) {
      return { requestId: request.id, decision: "deny", timestamp: Date.now() };
    }

    const text =
      ":warning: *Approval Required*\n" +
      "*Tool:* " + request.toolName + "\n" +
      "*Reason:* " + request.reason + "\n" +
      "Reply with `allow " + request.id.slice(0, 8) + "` or `deny " + request.id.slice(0, 8) + "`";

    for (const channelId of targets) {
      try {
        await this.apiCall("chat.postMessage", {
          channel: channelId,
          text,
        });
      } catch (err) {
        console.error("[Slack] Approval send failed: " + (err as Error).message);
      }
    }

    const shortId = request.id.slice(0, 8).toLowerCase();
    return new Promise<ApprovalResponse>((resolve) => {
      const existing = this.pendingApprovals.get(shortId);
      if (existing) {
        clearTimeout(existing.timer);
        existing.resolve({ requestId: existing.requestId, decision: "deny", timestamp: Date.now() });
        this.pendingApprovals.delete(shortId);
      }

      const timer = setTimeout(() => {
        const pending = this.pendingApprovals.get(shortId);
        if (!pending || pending.requestId !== request.id) {
          return;
        }
        this.pendingApprovals.delete(shortId);
        pending.resolve({ requestId: request.id, decision: "deny", timestamp: Date.now() });
      }, 300_000);

      this.pendingApprovals.set(shortId, {
        requestId: request.id,
        resolve,
        timer,
      });
    });
  }

  // --- Private ---

  private async apiCall(method: string, body: Record<string, unknown>): Promise<unknown> {
    const resp = await axios.post("https://slack.com/api/" + method, body, {
      headers: {
        Authorization: "Bearer " + this.botToken,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });
    if (resp.data && resp.data.ok === false) {
      throw new Error("Slack API error: " + (resp.data.error ?? "unknown"));
    }
    return resp.data;
  }

  private async discoverChannels(): Promise<void> {
    try {
      const resp = await this.apiCall("conversations.list", {
        types: "public_channel,private_channel",
        limit: 100,
      });
      const channels = (resp as Record<string, unknown>).channels as Array<Record<string, unknown>> | undefined;
      if (channels) {
        this.channelIds = channels
          .filter((c) => c.is_member)
          .map((c) => String(c.id));
      }
    } catch (err) {
      console.error("[Slack] Channel discovery failed: " + (err as Error).message);
    }
  }

  private async pollAllChannels(): Promise<void> {
    if (!this.running || !this.userMessageHandler) return;

    for (const channelId of this.channelIds) {
      try {
        const params: Record<string, unknown> = { channel: channelId, limit: 10 };
        const last = this.lastTs.get(channelId);
        if (last) params.oldest = last;

        const resp = await this.apiCall("conversations.history", params);
        const messages = (resp as Record<string, unknown>).messages as Array<Record<string, unknown>> | undefined;
        if (!messages || messages.length === 0) continue;

        for (const msg of messages) {
          if (msg.bot_id) continue;
          if (msg.subtype) continue;

          const ts = String(msg.ts ?? "");
          const text = String(msg.text ?? "");
          if (!text.trim()) continue;

          if (!last || ts > last) {
            this.lastTs.set(channelId, ts);
          }

          if (this.tryHandleApprovalText(text)) {
            continue;
          }

          this.lastActiveChannelId = channelId;
          await this.userMessageHandler(text);
        }
      } catch (err) {
        console.error("[Slack] Poll channel " + channelId + " error: " + (err as Error).message);
      }
    }
  }

  private resolveTargetChannelIds(): string[] {
    if (this.channelIds.length > 0) {
      return [...this.channelIds];
    }
    if (this.lastActiveChannelId !== null) {
      return [this.lastActiveChannelId];
    }
    return [];
  }

  private tryHandleApprovalText(text: string): boolean {
    const m = /^\s*(allow|deny)\s+([a-z0-9]{4,})\b/i.exec(text.trim());
    if (!m) {
      return false;
    }
    const decision = m[1].toLowerCase() === "allow" ? "allow" : "deny";
    const token = m[2].toLowerCase();
    const key = this.resolvePendingApprovalKey(token);
    if (!key) {
      return false;
    }
    const pending = this.pendingApprovals.get(key);
    if (!pending) {
      return false;
    }
    clearTimeout(pending.timer);
    this.pendingApprovals.delete(key);
    pending.resolve({ requestId: pending.requestId, decision, timestamp: Date.now() });
    return true;
  }

  private resolvePendingApprovalKey(token: string): string | null {
    if (this.pendingApprovals.has(token)) {
      return token;
    }
    const matches = [...this.pendingApprovals.keys()].filter((k) => k.startsWith(token));
    if (matches.length === 1) {
      return matches[0];
    }
    return null;
  }
}
