// ============================================================
// streaming-repl.ts - 流式 REPL
// 桥接 StreamUI（显示层）和 AgentLoop（事件层）
//
// 流程：用户输入 → StreamUI.onInput() 回调
//     → StreamingREPL.handleUserInput()
//     → AgentLoop.addUserMessage() + run()
//     → AgentLoop 发射事件 → StreamUI 追加显示
//     → 完成后 showPrompt()
// ============================================================

import { AgentLoop } from "../agent-loop.js";
import { StreamUI } from "./streaming-tui.js";

export class StreamingREPL {
  private ui: StreamUI;
  private agent: AgentLoop;
  private closed = false;
  private onClose: (() => void) | null = null;

  constructor(agent?: AgentLoop) {
    this.agent = agent ?? new AgentLoop();
    const model = this.agent.getModel();
    const toolsCount = this.agent.getToolCount();
    this.ui = new StreamUI(model, toolsCount);
  }

  async start(): Promise<void> {
    this.ui.onInput((cmd) => this.handleUserInput(cmd));
    this.wireAgentEvents();
    this.ui.start();
    await new Promise<void>((resolve) => {
      this.onClose = resolve;
    });
  }

  async stop(): Promise<void> {
    await this.close();
  }

  private async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.agent.shutdown();
    } catch {
      // ignore shutdown cleanup failures in chat exit path
    }
    this.ui.stop();
    this.onClose?.();
    this.onClose = null;
  }

  // ── 事件连接 ────────────────────────────────────────

  private wireAgentEvents(): void {
    // thinking 事件不直接打印 — 最终回复由 appendFinal 统一渲染
    // 避免与 handleUserInput 中的 appendFinal 重复输出
    // this.agent.on("thinking", (content: string) => {
    //   this.ui.appendThinking(content);
    // });

    this.agent.on("tool_start", (name: string, args: Record<string, unknown>) => {
      const cmd = this.argsToCommand(name, args);
      this.ui.appendToolStart(name, cmd);
    });

    this.agent.on("tool_result", (name: string, output: string, isError: boolean) => {
      let dur = 0;
      let realOutput = output;
      let tool = name;
      let cmd = "";

      try {
        const parsed = JSON.parse(output);
        if (parsed && typeof parsed === "object") {
          dur = parsed.duration ?? 0;
          realOutput = parsed.output ?? output;
          tool = parsed.tool ?? name;
          cmd = parsed.command ?? "";
        }
      } catch {
        // plain text output
      }

      if (isError) {
        this.ui.appendToolError(tool, cmd, realOutput, dur);
      } else {
        this.ui.appendToolSuccess(tool, cmd, realOutput, dur);
      }
    });

    this.agent.on("verification", (verdict: string, details: string) => {
      const status = verdict === "PASS" ? "pass" : verdict === "FAIL" ? "fail" : "warn";
      this.ui.appendValidation(status, details);
    });

    this.agent.on("turn_end", (_turnCount: number) => {
      // 可选：显示轮次统计
    });
  }

  // 将工具参数转换为可读命令字符串
  private argsToCommand(tool: string, args: Record<string, unknown>): string {
    switch (tool) {
      case "bash": {
        const cmd = args.cmd ?? args.command ?? args._ ?? "";
        const shell = args.shell ?? "";
        return shell ? shell + ' -c "' + cmd + '"' : String(cmd);
      }
      case "read": {
        const p = args.path ?? args.file ?? "";
        return "cat " + p;
      }
      case "write": {
        const p = args.path ?? args.file ?? "";
        return "write " + p;
      }
      case "todo": {
        const action = args.action ?? "list";
        return "todo " + action;
      }
      case "skill": {
        const name = args.name ?? "";
        return "skill " + name;
      }
      default:
        return Object.entries(args)
          .map(([k, v]) => k + "=" + JSON.stringify(v))
          .join(" ");
    }
  }

  // ── 用户输入处理 ────────────────────────────────────

  private async handleUserInput(cmd: string): Promise<void> {
    const normalized = cmd.trim().toLowerCase();
    if (normalized === "q" || normalized === "quit" || normalized === "exit") {
      await this.close();
      return;
    }

    const startTime = Date.now();

    this.ui.appendState("idle", "thinking");

    try {
      this.agent.addUserMessage(cmd);

      this.ui.appendState("thinking", "running");

      const response = await this.agent.run();

      this.ui.appendState("running", "done");

      if (response && response.trim()) {
        this.ui.appendFinal(response);
      }

      const totalMs = Date.now() - startTime;
      this.ui.appendDone(totalMs);

    } catch (err) {
      this.ui.appendError(err instanceof Error ? err.message : String(err));
      this.agent.reset();
    }

    this.ui.showPrompt();
  }
}
