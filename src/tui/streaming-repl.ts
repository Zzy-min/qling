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
import { handleSlashCommand } from "../commands/index.js";
import { SessionScheduler, type SessionTask } from "../session/session-scheduler.js";
import { SlashCommandContext } from "../commands/runtime.js";
import { SessionGoalManager } from "../session/session-goal-manager.js";
import { SessionGoalController } from "../session/goal-controller.js";
import type { SavedSessionSummary } from "../session/session-registry.js";
import { DaemonSessionApi } from "../session/daemon-session-api.js";
import { buildStatusLine } from "../statusline.js";
import { appendInputHistory, loadInputHistory } from "./input-history.js";
import { SerialInputQueue } from "./input-queue.js";

export class StreamingREPL {
  private ui: StreamUI;
  private agent: AgentLoop;
  private scheduler!: SessionScheduler;
  private goalController!: SessionGoalController;
  private readonly daemonSessionApi: DaemonSessionApi;
  private readonly startupResumeTarget?: string;
  private readonly startupContinue: boolean;
  private immediatePrompt: string | null = null;
  private statusLineEnabled = true;
  private readonly inputQueue: SerialInputQueue;
  private closed = false;
  private onClose: (() => void) | null = null;

  constructor(
    agent?: AgentLoop,
    options: {
      resumeSession?: string;
      continueSession?: boolean;
    } = {}
  ) {
    this.agent = agent ?? new AgentLoop();
    const model = this.agent.getModel();
    const toolsCount = this.agent.getToolCount();
    this.ui = new StreamUI(model, toolsCount);
    this.daemonSessionApi = new DaemonSessionApi();
    this.startupResumeTarget = options.resumeSession;
    this.startupContinue = options.continueSession ?? false;
    this.inputQueue = new SerialInputQueue({
      maxPending: 20,
      onQueued: ({ pendingCount }) => {
        this.ui.appendValidation("warn", `输入已排队，等待处理: ${pendingCount}`);
        void this.refreshStatusLine();
      },
      onRejected: ({ pendingCount, maxPending }) => {
        this.ui.appendValidation("warn", `输入队列已满，已忽略本次输入: ${pendingCount}/${maxPending}`);
        void this.refreshStatusLine();
      },
      onError: (error) => {
        this.ui.appendError(error instanceof Error ? error.message : String(error));
      },
    });
  }

  async start(): Promise<void> {
    const restored = await this.restoreStartupSessionIfNeeded();
    await this.rebuildSessionControllers();
    if (restored) {
      await this.agent.checkpointSession();
    }
    await this.loadLocalInputHistory();
    await this.refreshStatusLine();
    this.ui.onInput((cmd) => this.handleUserInput(cmd));
    this.wireAgentEvents();
    this.ui.start();
    if (restored) {
      this.ui.appendValidation("pass", `已恢复会话: ${restored.name} (${restored.sessionId})`);
    }
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
    if (this.scheduler) {
      await this.scheduler.stop();
    }
    this.ui.stop();
    this.onClose?.();
    this.onClose = null;
  }

  // ── 事件连接 ────────────────────────────────────────

  private wireAgentEvents(): void {
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

  private createSlashContext(): SlashCommandContext {
    return {
      agentLoop: this.agent,
      scheduler: this.scheduler,
      goalController: this.goalController,
      workspaceDir: this.agent.getWorkspaceDir(),
      inputQueue: {
        pendingCount: this.inputQueue.pendingCount,
        maxPending: this.inputQueue.maxPendingCount,
        isProcessing: this.inputQueue.isProcessing,
      },
      listSavedSessions: async () => this.agent.listSessionsDetailed(),
      switchSession: async (target) => this.switchSession(target),
      daemonSessionApi: this.daemonSessionApi,
      statusLine: {
        enabled: this.statusLineEnabled,
        setEnabled: (enabled: boolean) => {
          this.statusLineEnabled = enabled;
          this.ui.setStatusLineEnabled(enabled);
        },
        getLine: async () => {
          await this.refreshStatusLine();
          return buildStatusLine(this.createSlashContext());
        },
      },
      setImmediatePrompt: (prompt: string) => {
        this.immediatePrompt = prompt;
      },
      writeLine: (line = "") => this.ui.appendOutput(line),
      writeError: (line = "") => this.ui.appendError(line),
    };
  }

  private async runScheduledTask(task: SessionTask): Promise<void> {
    this.ui.appendThinking(`[loop ${task.id}] ${task.prompt}`);
    await this.processPrompt(task.prompt);
  }

  private async refreshStatusLine(): Promise<void> {
    if (!this.statusLineEnabled) return;
    try {
      this.ui.setStatusLine(await buildStatusLine(this.createSlashContext()));
    } catch {
      this.ui.setStatusLine(null);
    }
  }

  private async loadLocalInputHistory(): Promise<void> {
    try {
      this.ui.setHistory(await loadInputHistory({ stateDir: this.agent.getRuntimeRootDir() }));
    } catch {
      // Local history is best-effort and must not block chat startup.
    }
  }

  private async recordLocalInputHistory(input: string): Promise<void> {
    try {
      await appendInputHistory(input, { stateDir: this.agent.getRuntimeRootDir() });
    } catch {
      // Local history is best-effort and must not block prompt handling.
    }
  }

  private async processPrompt(input: string): Promise<void> {
    let currentPrompt: string | null = input;
    this.scheduler.setBusy(true);

    try {
      while (currentPrompt && !this.closed) {
        const startTime = Date.now();
        this.ui.appendState("idle", "thinking");

        try {
          this.agent.addUserMessage(currentPrompt);
          this.ui.appendState("thinking", "running");
          this.ui.startProgress("agent");
          const response = await this.agent.run();
          this.ui.stopProgress();
          this.ui.appendState("running", "done");

          if (response && response.trim()) {
            this.ui.appendFinal(response);
          }

          await this.agent.checkpointSession();

          const totalMs = Date.now() - startTime;
          this.ui.appendDone(totalMs);

        } catch (err) {
          this.ui.stopProgress();
          this.ui.appendError(err instanceof Error ? err.message : String(err));
          this.agent.reset();
          currentPrompt = null;
          break;
        }

        const goalResult = await this.goalController.afterTurn({
          transcript: SessionGoalController.messagesToTranscript(this.agent.getMessagesSnapshot()),
          stats: (() => {
            const stats = this.agent.getSessionStats();
            return {
              turnCount: stats.turnCount,
              tokens: stats.tokens,
            };
          })(),
        });

        if (goalResult.status === "continue" && goalResult.continuePrompt) {
          this.ui.appendValidation("warn", `goal 未达成: ${goalResult.reason ?? "条件未满足"}`);
          currentPrompt = goalResult.continuePrompt;
          continue;
        }

        if (goalResult.status === "achieved") {
          this.ui.appendValidation("pass", `goal 已达成: ${goalResult.reason ?? "条件满足"}`);
        } else if (goalResult.status === "cleared") {
          this.ui.appendValidation("warn", `goal 已停止: ${goalResult.reason ?? "已清除"}`);
        }

        currentPrompt = null;
      }
    } finally {
      this.scheduler.setBusy(false);
      await this.scheduler.runDueTasksOnce();
    }
  }

  private async handleUserInput(cmd: string): Promise<void> {
    if (await this.handleImmediateQueueCommand(cmd)) return;
    const accepted = await this.inputQueue.enqueue(cmd, (input) => this.handleQueuedUserInput(input));
    if (!accepted || this.closed) return;
    if (this.inputQueue.isProcessing || this.inputQueue.pendingCount > 0) return;
    await this.refreshStatusLine();
    this.ui.showPrompt();
  }

  private async handleImmediateQueueCommand(cmd: string): Promise<boolean> {
    const action = this.parseImmediateQueueCommand(cmd);
    if (!action) return false;

    if (action === "usage") {
      this.ui.appendValidation(
        "warn",
        "输入队列命令用法: /queue [status|clear|cancel] 或 /队列 [状态|清空|取消]；中文简写: /清空队列"
      );
    } else if (action === "clear") {
      const cleared = this.inputQueue.clearPending();
      this.ui.appendValidation("warn", `输入队列已清空: ${cleared}`);
    } else {
      const running = this.inputQueue.isProcessing ? "yes" : "no";
      const max = Number.isFinite(this.inputQueue.maxPendingCount) ? String(this.inputQueue.maxPendingCount) : "-";
      this.ui.appendValidation(
        "pass",
        `输入队列: running=${running} pending=${this.inputQueue.pendingCount} max=${max}`
      );
    }

    await this.refreshStatusLine();
    if (!this.closed) {
      this.ui.showPrompt();
    }
    return true;
  }

  private parseImmediateQueueCommand(cmd: string): "status" | "clear" | "usage" | null {
    const parts = cmd.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return null;

    const command = parts[0].toLowerCase();
    const argument = parts[1]?.toLowerCase();

    if (command === "/清空队列" || command === "/取消队列") {
      return parts.length === 1 ? "clear" : "usage";
    }

    if (command !== "/queue" && command !== "/队列") {
      return null;
    }

    if (parts.length === 1) {
      return "status";
    }

    if (parts.length > 2 || !argument) {
      return "usage";
    }

    if (argument === "status" || argument === "状态") {
      return "status";
    }

    if (argument === "clear" || argument === "cancel" || argument === "清空" || argument === "取消") {
      return "clear";
    }

    return "usage";
  }

  private async handleQueuedUserInput(cmd: string): Promise<void> {
    const input = cmd.trim();
    if (!input) {
      return;
    }

    if (this.isLocalExitCommand(input)) {
      await this.close();
      return;
    }

    // v0.4 Slash Commands
    this.immediatePrompt = null;
    const handled = await handleSlashCommand(input, this.createSlashContext());
    if (handled) {
      if (this.immediatePrompt) {
        const nextPrompt = this.immediatePrompt;
        this.immediatePrompt = null;
        await this.processPrompt(nextPrompt);
      } else {
        await this.scheduler.runDueTasksOnce();
      }
      return;
    }

    await this.recordLocalInputHistory(input);
    await this.processPrompt(input);
  }

  private isLocalExitCommand(input: string): boolean {
    const normalized = input.trim().toLowerCase();
    return normalized === "q"
      || normalized === "quit"
      || normalized === "exit"
      || normalized === "/q"
      || normalized === "/quit"
      || normalized === "/exit"
      || normalized === "/退出";
  }

  private async restoreStartupSessionIfNeeded(): Promise<SavedSessionSummary | null> {
    if (this.startupResumeTarget) {
      return this.agent.restoreSession(this.startupResumeTarget);
    }
    if (this.startupContinue) {
      return this.agent.restoreLatestSession();
    }
    return null;
  }

  private async rebuildSessionControllers(): Promise<void> {
    if (this.scheduler) {
      await this.scheduler.stop();
    }

    this.scheduler = new SessionScheduler({
      stateDir: this.agent.getRuntimeRootDir(),
      sessionId: this.agent.getSessionId(),
      runner: "session",
      onDue: async (task) => {
        await this.runScheduledTask(task);
      },
    });
    await this.scheduler.init();
    this.scheduler.start();

    const goalManager = new SessionGoalManager({
      stateDir: this.agent.getRuntimeRootDir(),
      sessionId: this.agent.getSessionId(),
    });
    this.goalController = new SessionGoalController({
      manager: goalManager,
      runner: "session",
    });
    await this.goalController.init();
  }

  private async switchSession(target?: string): Promise<(SavedSessionSummary & {
    activeTaskCount?: number;
    activeGoalStatus?: string | null;
  }) | null> {
    const restored = target
      ? await this.agent.restoreSession(target)
      : await this.agent.restoreLatestSession();
    if (!restored) {
      return null;
    }

    await this.rebuildSessionControllers();
    await this.agent.checkpointSession();

    const tasks = await this.scheduler.listTasks();
    const goal = await this.goalController.getGoalStatus();
    return {
      ...restored,
      activeTaskCount: tasks.filter((task) => task.status !== "canceled" && task.status !== "completed").length,
      activeGoalStatus: goal?.status ?? null,
    };
  }
}
