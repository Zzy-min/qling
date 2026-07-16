// ============================================================
// 轻灵 - Console Channel（控制台通道）
// 封装标准输入/输出为 Channel 接口
// ============================================================

import * as readline from "readline";
import type { Channel, ApprovalRequest, ApprovalResponse } from "./types.js";

export class ConsoleChannel implements Channel {
  name = "console";
  private userMessageHandler: ((msg: string) => Promise<void>) | null = null;
  private rl: readline.Interface | null = null;
  private readonly headless: boolean;

  constructor(options: { headless?: boolean } = {}) {
    this.headless = options.headless === true;
  }

  async start(): Promise<void> {
    if (this.headless) return;
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    this.rl.on("line", async (line: string) => {
      const trimmed = line.trim();
      if (trimmed && this.userMessageHandler) {
        await this.userMessageHandler(trimmed);
      }
    });

    this.rl.on("close", () => {
      // Do not force process exit here.
      // In run mode the channel may be attached with non-interactive stdio,
      // and eager exit can terminate one-shot execution before agent.run() completes.
      this.rl = null;
    });
  }

  async stop(): Promise<void> {
    this.rl?.close();
    this.rl = null;
  }

  async sendText(text: string): Promise<void> {
    process.stdout.write(text + "\n");
  }

  async sendToolStart(toolName: string, args: Record<string, unknown>): Promise<void> {
    const preview = JSON.stringify(args).slice(0, 80);
    console.error("[tool] " + toolName + ": " + preview);
  }

  async sendToolResult(toolName: string, output: string, isError: boolean): Promise<void> {
    const icon = isError ? "x" : "+";
    console.error("[" + icon + "] " + toolName + ": " + output.split("\n")[0].slice(0, 80));
  }

  async sendError(text: string): Promise<void> {
    console.error("[error] " + text);
  }

  onUserMessage(handler: (msg: string) => Promise<void>): void {
    this.userMessageHandler = handler;
  }

  async requestApproval(request: ApprovalRequest): Promise<ApprovalResponse> {
    if (this.headless) {
      return {
        requestId: request.id,
        decision: "deny",
        timestamp: Date.now(),
      };
    }
    await this.sendText(
      "\n[Approval Required] Tool: " + request.toolName + "\n" +
      "Reason: " + request.reason + "\n" +
      "Allow? (y/n): "
    );

    return new Promise<ApprovalResponse>((resolve) => {
      const originalHandler = this.userMessageHandler;
      this.userMessageHandler = async (msg: string) => {
        this.userMessageHandler = originalHandler;
        const answer = msg.toLowerCase();
        resolve({
          requestId: request.id,
          decision: answer === "y" || answer === "yes" ? "allow" : "deny",
          timestamp: Date.now(),
        });
      };
    });
  }
}
