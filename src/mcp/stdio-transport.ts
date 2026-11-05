// ============================================================
// 轻灵 - MCP stdio transport
// JSON-RPC 2.0 over stdin/stdout via child_process
// ============================================================

import { spawn, ChildProcess } from "child_process";
import { StringDecoder } from "node:string_decoder";
import type { MCPMessage } from "./types.js";

export type MessageHandler = (msg: MCPMessage) => void;
export type ErrorHandler = (err: Error) => void;
export type CloseHandler = () => void;

export class StdioTransport {
  private proc: ChildProcess | null = null;
  private buffer = "";
  private decoder = new StringDecoder("utf8");
  private messageHandler: MessageHandler | null = null;
  private errorHandler: ErrorHandler | null = null;
  private closeHandler: CloseHandler | null = null;
  private spawnPromise: Promise<void>;

  constructor(
    private command: string,
    private args: string[],
    private env?: Record<string, string>,
    private options: { inheritEnv?: boolean; maxMessageBytes?: number; logStderr?: boolean } = {},
  ) {
    this.spawnPromise = new Promise<void>((resolve, reject) => {
      this.proc = spawn(this.command, this.args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: this.options.inheritEnv === false ? { ...this.env } : { ...process.env, ...this.env },
        windowsHide: true,
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
        this.buffer += this.decoder.write(chunk);
        if (this.options.maxMessageBytes && Buffer.byteLength(this.buffer, "utf8") > this.options.maxMessageBytes) {
          this.buffer = "";
          this.errorHandler?.(new Error("MCP message exceeds configured byte limit"));
          this.proc?.kill();
          return;
        }
        this.processBuffer();
      });

      this.proc.stderr?.on("data", (chunk: Buffer) => {
        // 交给 console guard：全屏 TUI 活跃时会进入可寻址内容区，
        // 避免子进程 stderr 触发终端原生滚动并冲掉固定顶栏/输入框。
        if (this.options.logStderr !== false) console.error("[MCP:stdio] " + chunk.toString().trimEnd());
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

  send(msg: MCPMessage, signal?: AbortSignal): void {
    if (signal?.aborted) throw new Error("MCP request aborted");
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
