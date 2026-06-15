// ============================================================
// 轻灵 - 交互模式 REPL
// 多轮对话，不用每次都重开
// ============================================================

import * as readline from "readline";
import { AgentLoop } from "./agent-loop.js";
import { handleSlashCommand } from "./commands/index.js";
import type { SlashCommandContext } from "./commands/runtime.js";
import { SessionGoalController } from "./session/goal-controller.js";
import { SessionGoalManager } from "./session/session-goal-manager.js";
import { SessionScheduler, type SessionTask } from "./session/session-scheduler.js";
import type { SavedSessionSummary } from "./session/session-registry.js";

export type ReplInputResult = "continue" | "exit";
type RestoredSessionWithLocalStatus = SavedSessionSummary & {
  activeTaskCount?: number;
  activeGoalStatus?: string | null;
};

export class Repl {
  private agent: AgentLoop;
  private rl: readline.Interface;
  private readonly startupResumeTarget?: string;
  private readonly startupContinue: boolean;
  private scheduler: SessionScheduler | null = null;
  private goalController: SessionGoalController | null = null;
  private controllersSessionId: string | null = null;
  private immediatePrompt: string | null = null;
  private runningScheduledTask = false;

  constructor(
    agent?: AgentLoop,
    options: {
      resumeSession?: string;
      continueSession?: boolean;
    } = {}
  ) {
    this.agent = agent ?? new AgentLoop();
    this.startupResumeTarget = options.resumeSession;
    this.startupContinue = options.continueSession ?? false;
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  async start(): Promise<void> {
    console.log(`
╔══════════════════════════════════════════╗
║         🌬️ 轻灵 REPL 模式               ║
║   输入任务，回车执行。输入 q 退出。       ║
║   输入 !reset 重置对话。                 ║
║   输入 !save [name] 保存会话。           ║
║   输入 !load [name] 恢复会话。           ║
║   输入 !sessions 查看已保存会话。         ║
╚══════════════════════════════════════════╝
`);
    const restored = await this.restoreStartupSessionIfNeeded();
    const restoredWithLocalStatus = restored
      ? await this.finalizeRestoredSession(restored)
      : null;
    if (restoredWithLocalStatus) {
      console.log(`${this.formatStartupRestoreMessage(restoredWithLocalStatus)}\n`);
    }
    this.loop();
  }

  private async loop(): Promise<void> {
    const prompt = () =>
      new Promise<string>((resolve) => {
        this.rl.question("🎋 > ", (answer) => resolve(answer));
      });

    while (true) {
      const input = await prompt();
      const result = await this.handleInputLine(input);
      if (result === "exit") {
        return;
      }
    }
  }

  async handleInputLine(input: string): Promise<ReplInputResult> {
    const trimmedInput = input.trim();

    if (trimmedInput === "q" || trimmedInput === "quit" || trimmedInput === "exit") {
      console.log("👋 再见！");
      try {
        await this.agent.shutdown();
      } catch {
        // ignore shutdown cleanup failures in REPL exit path
      }
      await this.resetLocalSessionControllers();
      this.rl.close();
      process.stdin.pause();
      return "exit";
    }

    if (trimmedInput === "!reset" || trimmedInput === "reset") {
      this.agent.reset();
      const canceledTasks = await this.cleanupLocalControlStateForReset();
      await this.agent.checkpointSession();
      console.log(`✅ 对话已重置。${canceledTasks > 0 ? `已同步取消 ${canceledTasks} 个 loop 任务。` : ""}\n`);
      return "continue";
    }

    if (trimmedInput === "!save" || trimmedInput.startsWith("!save ")) {
      const name = trimmedInput.replace(/^!save\s*/, "") || undefined;
      const file = await this.agent.saveSession(name);
      console.log(`💾 会话已保存: ${file}\n`);
      return "continue";
    }

    if (trimmedInput === "!load" || trimmedInput.startsWith("!load ")) {
      const name = trimmedInput.replace(/^!load\s*/, "");
      if (!name) {
        await this.writeLegacySessionList();
      } else {
        const restoreTarget = await this.resolveLegacyLoadTarget(name);
        const restored = await this.agent.restoreSession(restoreTarget);
        const restoredWithLocalStatus = restored
          ? await this.finalizeRestoredSession(restored)
          : null;
        console.log(
          restoredWithLocalStatus
            ? `${this.formatLegacyRestoreMessage(restoredWithLocalStatus)}\n`
            : `❌ 找不到会话: ${name}\n`
        );
      }
      return "continue";
    }

    if (trimmedInput === "!sessions" || trimmedInput === "!ls") {
      await this.writeLegacySessionList();
      return "continue";
    }

    if (!trimmedInput) {
      return "continue";
    }

    if (trimmedInput.startsWith("/")) {
      await this.ensureLocalSessionControllers();
      this.immediatePrompt = null;
      const handledSlashCommand = await handleSlashCommand(trimmedInput, this.createSlashContext());
      if (handledSlashCommand) {
        if (this.immediatePrompt) {
          const nextPrompt = this.immediatePrompt;
          this.immediatePrompt = null;
          await this.processPrompt(nextPrompt);
        } else {
          await this.scheduler?.runDueTasksOnce();
        }
        return "continue";
      }
    }

    await this.processPrompt(input);
    return "continue";
  }

  private async processPrompt(input: string): Promise<void> {
    let currentPrompt: string | null = input;
    this.scheduler?.setBusy(true);

    try {
      while (currentPrompt) {
        console.log("\n🎋 轻灵正在思考...\n");

        try {
          this.agent.addUserMessage(currentPrompt);
          const response = await this.agent.run();
          await this.agent.checkpointSession();
          console.log(`\n${response}\n`);
        } catch (err) {
          console.error(`\n❌ 出错: ${err instanceof Error ? err.message : String(err)}\n`);
          console.log("💡 输入 !reset 重置对话，或继续输入新任务。\n");
          currentPrompt = null;
          break;
        }

        currentPrompt = await this.resolveGoalContinuationPrompt();
      }
    } finally {
      this.scheduler?.setBusy(false);
      if (!this.runningScheduledTask) {
        await this.scheduler?.runDueTasksOnce();
      }
    }
  }

  private async resolveGoalContinuationPrompt(): Promise<string | null> {
    if (!this.goalController) {
      return null;
    }
    if (
      typeof (this.agent as any).getMessagesSnapshot !== "function" ||
      typeof (this.agent as any).getSessionStats !== "function"
    ) {
      return null;
    }

    try {
      const stats = (this.agent as any).getSessionStats();
      const goalResult = await this.goalController.afterTurn({
        transcript: SessionGoalController.messagesToTranscript((this.agent as any).getMessagesSnapshot()),
        stats: {
          turnCount: stats.turnCount ?? 0,
          tokens: stats.tokens ?? 0,
        },
      });

      if (goalResult.status === "continue" && goalResult.continuePrompt) {
        console.log(`⚠️ goal 未达成: ${goalResult.reason ?? "条件未满足"}\n`);
        return goalResult.continuePrompt;
      }
      if (goalResult.status === "achieved") {
        console.log(`✅ goal 已达成: ${goalResult.reason ?? "条件满足"}\n`);
      } else if (goalResult.status === "cleared") {
        console.log(`⚠️ goal 已停止: ${goalResult.reason ?? "已清除"}\n`);
      }
    } catch (err) {
      console.error(`⚠️ goal 评估失败: ${err instanceof Error ? err.message : String(err)}\n`);
    }

    return null;
  }

  private async cleanupLocalControlStateForReset(): Promise<number> {
    let canceledTasks = 0;
    if (this.scheduler && typeof (this.scheduler as any).cancelAllTasks === "function") {
      canceledTasks = await this.scheduler.cancelAllTasks();
    }

    if (
      this.goalController &&
      typeof (this.goalController as any).getGoalStatus === "function" &&
      typeof (this.goalController as any).clearGoal === "function"
    ) {
      const goalStatus = await this.goalController.getGoalStatus();
      if (goalStatus?.status === "active") {
        await this.goalController.clearGoal("conversation_reset");
      }
    }

    return canceledTasks;
  }

  private createSlashContext(): SlashCommandContext {
    return {
      agentLoop: this.agent,
      scheduler: this.scheduler ?? undefined,
      goalController: this.goalController ?? undefined,
      workspaceDir: typeof (this.agent as any).getWorkspaceDir === "function"
        ? (this.agent as any).getWorkspaceDir()
        : undefined,
      listSavedSessions: async () => this.listSavedSessionSummariesForSlash(),
      switchSession: async (target) => this.switchSession(target),
      setImmediatePrompt: (prompt: string) => {
        this.immediatePrompt = prompt;
      },
      writeLine: (line = "") => console.log(line),
      writeError: (line = "") => console.error(line),
    };
  }

  private async listSavedSessionSummariesForSlash(): Promise<SavedSessionSummary[]> {
    if (typeof (this.agent as any).listSessionsDetailed === "function") {
      return (await (this.agent as any).listSessionsDetailed()) as SavedSessionSummary[];
    }

    if (typeof (this.agent as any).listSessions !== "function") {
      return [];
    }

    const names = await (this.agent as any).listSessions() as string[];
    const placeholderTime = new Date(0).toISOString();
    return names.map((name) => ({
      name,
      sessionId: name,
      workspaceDir: null,
      createdAt: placeholderTime,
      updatedAt: placeholderTime,
      turnCount: 0,
      messageCount: 0,
      sessionTokens: 0,
      compactionCount: 0,
    }));
  }

  private async writeLegacySessionList(): Promise<void> {
    if (typeof (this.agent as any).listSessionsDetailed === "function") {
      const sessions = await (this.agent as any).listSessionsDetailed() as SavedSessionSummary[];
      console.log(this.formatLegacyDetailedSessionList(sessions));
      return;
    }

    const sessions = await this.agent.listSessions();
    if (sessions.length === 0) {
      console.log("📭 没有已保存的会话。\n");
    } else {
      console.log("📂 已保存的会话:\n" + sessions.map((s, i) => `  ${i + 1}. ${s}`).join("\n") + "\n");
    }
  }

  private formatLegacyDetailedSessionList(sessions: SavedSessionSummary[]): string {
    if (sessions.length === 0) {
      return "📭 没有已保存的会话。\n";
    }

    const lines = ["📂 已保存的会话:"];
    sessions.forEach((session, index) => {
      lines.push(`  ${index + 1}. ${session.name} | ${session.sessionId}`);
      lines.push(
        `     更新: ${this.formatSessionTime(session.updatedAt)} | turns=${session.turnCount} | messages=${session.messageCount}`
      );
    });
    return `${lines.join("\n")}\n`;
  }

  private async resolveLegacyLoadTarget(rawTarget: string): Promise<string> {
    const target = rawTarget.trim();
    const selectionIndex = this.parseLegacyLoadIndex(target);
    if (selectionIndex === null) {
      return target;
    }

    const candidates = await this.listLegacyLoadCandidates();
    return candidates[selectionIndex - 1] ?? target;
  }

  private parseLegacyLoadIndex(target: string): number | null {
    if (!/^[1-9]\d*$/.test(target)) {
      return null;
    }

    const selectionIndex = Number(target);
    return Number.isSafeInteger(selectionIndex) ? selectionIndex : null;
  }

  private async listLegacyLoadCandidates(): Promise<string[]> {
    if (typeof (this.agent as any).listSessionsDetailed === "function") {
      const sessions = await (this.agent as any).listSessionsDetailed() as SavedSessionSummary[];
      return sessions.map((session) => session.name);
    }

    if (typeof (this.agent as any).listSessions !== "function") {
      return [];
    }

    return (await (this.agent as any).listSessions()) as string[];
  }

  private formatSessionTime(value: string): string {
    const ts = Date.parse(value);
    return Number.isNaN(ts) ? value : new Date(ts).toLocaleString();
  }

  private async ensureLocalSessionControllers(): Promise<void> {
    if (
      typeof (this.agent as any).getRuntimeRootDir !== "function" ||
      typeof (this.agent as any).getSessionId !== "function"
    ) {
      return;
    }

    const sessionId = (this.agent as any).getSessionId();
    if (this.scheduler && this.goalController && this.controllersSessionId === sessionId) {
      return;
    }

    await this.resetLocalSessionControllers();
    const stateDir = (this.agent as any).getRuntimeRootDir();
    this.scheduler = new SessionScheduler({
      stateDir,
      sessionId,
      runner: "session",
      onDue: async (task: SessionTask) => {
        this.runningScheduledTask = true;
        try {
          await this.processPrompt(task.prompt);
        } finally {
          this.runningScheduledTask = false;
        }
      },
    });
    await this.scheduler.init();
    this.scheduler.start();

    const goalManager = new SessionGoalManager({ stateDir, sessionId });
    this.goalController = new SessionGoalController({
      manager: goalManager,
      runner: "session",
    });
    await this.goalController.init();
    this.controllersSessionId = sessionId;
  }

  private async resetLocalSessionControllers(): Promise<void> {
    if (this.scheduler) {
      await this.scheduler.stop();
    }
    this.scheduler = null;
    this.goalController = null;
    this.controllersSessionId = null;
  }

  private async switchSession(target?: string): Promise<RestoredSessionWithLocalStatus | null> {
    const restored = target
      ? await this.agent.restoreSession(target)
      : await this.agent.restoreLatestSession();
    if (!restored) {
      return null;
    }

    return this.finalizeRestoredSession(restored);
  }

  private async finalizeRestoredSession(restored: SavedSessionSummary): Promise<RestoredSessionWithLocalStatus> {
    await this.agent.checkpointSession();
    await this.ensureLocalSessionControllers();
    return this.withLocalRestoreStatus(restored);
  }

  private async withLocalRestoreStatus(restored: SavedSessionSummary): Promise<RestoredSessionWithLocalStatus> {
    if (!this.scheduler && !this.goalController) {
      return restored;
    }

    const tasks = this.scheduler ? await this.scheduler.listTasks() : [];
    const goal = this.goalController ? await this.goalController.getGoalStatus() : null;
    return {
      ...restored,
      activeTaskCount: tasks.filter((task) => task.status !== "canceled" && task.status !== "completed").length,
      activeGoalStatus: goal?.status ?? null,
    };
  }

  private formatLegacyRestoreMessage(restored: RestoredSessionWithLocalStatus): string {
    return `📂 会话已恢复: ${restored.name} (${restored.sessionId})${this.formatLocalRestoreStatusSuffix(restored)}`;
  }

  private formatStartupRestoreMessage(restored: RestoredSessionWithLocalStatus): string {
    return `♻️ 已恢复会话: ${restored.name} (${restored.sessionId})${this.formatLocalRestoreStatusSuffix(restored)}`;
  }

  private formatLocalRestoreStatusSuffix(restored: RestoredSessionWithLocalStatus): string {
    const localStatus: string[] = [];
    if (typeof restored.activeTaskCount === "number") {
      localStatus.push(`Loop Tasks: ${restored.activeTaskCount}`);
    }
    if (restored.activeGoalStatus) {
      localStatus.push(`Goal: ${restored.activeGoalStatus}`);
    }

    return localStatus.length > 0 ? ` - ${localStatus.join(", ")}` : "";
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
}
