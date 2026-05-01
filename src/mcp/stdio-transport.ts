// ============================================================
// 轻灵 - MCP stdio transport
// JSON-RPC 2.0 over stdin/stdout via child_process
// ============================================================

import { spawn, ChildProcess } from "child_process";
import type { MCPMessage } from "./types.js";

export type MessageHandler = (msg: MCPMessage) => void;
export type ErrorHandler = (err: Error) => void;
export type CloseHandler = () => void;

export class StdioTransport {
  private proc: ChildProcess | null = null;
  private buffer = "";
  private messageHandler: MessageHandler | null = null;
  private errorHandler: ErrorHandler | null = null;
  private closeHandler: CloseHandler | null = null;
  private spawnPromise: Promise<void>;

  constructor(
    private command: string,
    private args: string[],
    private env?: Record<string, string>,
  ) {
    this.spawnPromise = new Promise<void>((resolve, reject) => {
      this.proc = spawn(this.command, this.args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...this.env },
      });

      this.proc.on("error", (err) => {
        if (this.errorHandler) this.errorHandler(err);
        reject(err);
      });

      this.proc.on("spawn", () => {
        resolve();
      });

      // Fallback: if no spawn event within 1s, assume spawned
      setTimeout(() => resolve(), 1000);

      this.proc.stdout?.on("data", (chunk: Buffer) => {
        this.buffer += chunk.toString();
        this.processBuffer();
      });

      this.proc.stderr?.on("data", (chunk: Buffer) => {
        process.stderr.write("[MCP:stdio] " + chunk.toString());
      });

      this.proc.on("close", () => {
        if (this.closeHandler) this.closeHandler();
      });
    });
  }

  async ready(): Promise<void> {
    await this.spawnPromise;
  }

  isAlive(): boolean {
    return this.proc !== null && !this.proc.killed && this.proc.stdin !== null && !this.proc.stdin.destroyed;
  }

  send(msg: MCPMessage): void {
    if (!this.proc?.stdin || this.proc.stdin.destroyed) {
      throw new Error("MCP stdin not available");
    }
    this.proc.stdin.write(JSON.stringify(msg) + "\n");
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
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed) as MCPMessage;
        if (this.messageHandler) this.messageHandler(msg);
      } catch {
        // skip malformed JSON
      }
    }
  }
}
