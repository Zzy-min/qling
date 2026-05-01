// ============================================================
// 轻灵 - MCP Streamable HTTP transport
// JSON-RPC 2.0 over HTTP POST with SSE support
// ============================================================

import type { MCPMessage } from "./types.js";

export type MessageHandler = (msg: MCPMessage) => void;
export type ErrorHandler = (err: Error) => void;
export type CloseHandler = () => void;

export class HttpTransport {
  private url: string;
  private headers: Record<string, string>;
  private timeout: number;
  private sessionId: string | null = null;
  private messageHandler: MessageHandler | null = null;
  private errorHandler: ErrorHandler | null = null;
  private closeHandler: CloseHandler | null = null;

  constructor(
    url: string,
    headers?: Record<string, string>,
    timeout?: number,
  ) {
    this.url = url;
    this.headers = { ...headers };
    this.timeout = timeout ?? 30_000;
  }

  async send(msg: MCPMessage): Promise<void> {
    const reqHeaders: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...this.headers,
    };

    if (this.sessionId) {
      reqHeaders["mcp-session-id"] = this.sessionId;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await fetch(this.url, {
        method: "POST",
        headers: reqHeaders,
        body: JSON.stringify(msg),
        signal: controller.signal,
      });

      // Capture Mcp-Session-Id from initialize response
      const sid = res.headers.get("mcp-session-id");
      if (sid) this.sessionId = sid;

      const contentType = res.headers.get("content-type") ?? "";

      if (contentType.includes("text/event-stream")) {
        await this.handleSSE(res);
      } else if (contentType.includes("application/json")) {
        const text = await res.text();
        if (text.length > 0) {
          const body = JSON.parse(text);
          if (this.messageHandler) this.messageHandler(body as MCPMessage);
        }
      } else {
        // Empty response (e.g., 202 Accepted for notifications)
        if (res.status >= 400) {
          throw new Error(`MCP HTTP ${res.status}: ${await res.text()}`);
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        throw new Error("MCP HTTP request timeout");
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  onError(handler: ErrorHandler): void {
    this.errorHandler = handler;
  }

  onClose(handler: CloseHandler): void {
    this.closeHandler = handler;
  }

  async close(): Promise<void> {
    // HTTP transport is stateless, nothing to close
    if (this.closeHandler) this.closeHandler();
  }

  // --- Private ---

  private async handleSSE(res: Response): Promise<void> {
    const reader = res.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(":")) continue; // skip empty lines and comments

          if (trimmed.startsWith("data: ")) {
            const data = trimmed.slice(6);
            if (data === "[DONE]") return;
            try {
              const msg = JSON.parse(data) as MCPMessage;
              if (this.messageHandler) this.messageHandler(msg);
            } catch {
              // skip malformed JSON
            }
          }
        }
      }
    } catch (err) {
      if (this.errorHandler) this.errorHandler(err as Error);
    } finally {
      reader.releaseLock();
    }
  }
}
