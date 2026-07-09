import * as fs from "fs/promises";
import { existsSync } from "fs";
import * as path from "path";

import { AgentLoop } from "../agent-loop.js";
import { applyConfigToProcessEnv, loadQlingConfig } from "../config.js";
import { buildToolRegistry } from "../tools/index.js";
import { SessionGoalController } from "./goal-controller.js";
import { SessionGoalManager } from "./session-goal-manager.js";
import { SessionScheduler } from "./session-scheduler.js";

export interface DurableSessionSupervisorOptions {
  stateDir: string;
  tickIntervalMs?: number;
  log?: (message: string) => void;
}

export class DurableSessionSupervisor {
  private readonly stateDir: string;
  private readonly tickIntervalMs: number;
  private readonly log: (message: string) => void;
  private readonly runningSessions = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(options: DurableSessionSupervisorOptions) {
    this.stateDir = options.stateDir;
    this.tickIntervalMs = options.tickIntervalMs ?? 1_000;
    this.log = options.log ?? (() => {});
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.tickIntervalMs);
    void this.tick();
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const sessionIds = await this.collectSessionIds();
      for (const sessionId of sessionIds) {
        if (this.runningSessions.has(sessionId)) {
          continue;
        }
        const handledGoal = await this.tryRunDurableGoal(sessionId);
        if (handledGoal) {
          continue;
        }
        await this.tryRunDurableLoopTasks(sessionId);
      }
    } finally {
      this.ticking = false;
    }
  }

  private async collectSessionIds(): Promise<string[]> {
    const sessionIds = new Set<string>();
    for (const dirName of ["session-goals", "session-tasks"]) {
      const dirPath = path.join(this.stateDir, dirName);
      if (!existsSync(dirPath)) continue;
      const files = await fs.readdir(dirPath);
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        sessionIds.add(path.basename(file, ".json"));
      }
    }
    return Array.from(sessionIds.values()).sort();
  }

  private async tryRunDurableGoal(sessionId: string): Promise<boolean> {
    const manager = new SessionGoalManager({ stateDir: this.stateDir, sessionId });
    await manager.init();
    const goal = await manager.getGoalStatus();
    if (!goal || goal.status !== "active" || goal.runner !== "daemon" || !goal.pending) {
      return false;
    }

    this.runningSessions.add(sessionId);
    try {
      await this.runDurableGoal(sessionId);
    } finally {
      this.runningSessions.delete(sessionId);
    }
    return true;
  }

  private async tryRunDurableLoopTasks(sessionId: string): Promise<boolean> {
    const scheduler = new SessionScheduler({
      stateDir: this.stateDir,
      sessionId,
      runner: "daemon",
      onDue: async (task) => {
        await this.executePromptTurn(sessionId, task.prompt);
      },
    });
    await scheduler.init();
    const tasks = await scheduler.listTasks();
    const now = Date.now();
    const hasDue = tasks.some((task) =>
      task.runner === "daemon" &&
      task.status !== "canceled" &&
      task.status !== "completed" &&
      (task.pending || task.nextRunAt <= now)
    );
    if (!hasDue) {
      return false;
    }

    this.runningSessions.add(sessionId);
    try {
      await scheduler.runDueTasksOnce();
    } finally {
      this.runningSessions.delete(sessionId);
    }
    return true;
  }

  private async runDurableGoal(sessionId: string): Promise<void> {
    const manager = new SessionGoalManager({ stateDir: this.stateDir, sessionId });
    const controller = new SessionGoalController({
      manager,
      runner: "daemon",
    });
    await controller.init();

    let goal = await controller.getGoalStatus();
    if (!goal || goal.status !== "active" || goal.runner !== "daemon") {
      return;
    }

    let prompt =
      goal.evaluatedTurns > 0 && goal.lastReason
        ? controller.buildContinuationPrompt(goal.condition, goal.lastReason)
        : controller.buildInitialPrompt(goal.condition);

    while (goal && goal.status === "active") {
      const turn = await this.executePromptTurn(sessionId, prompt);
      const outcome = await controller.afterTurn({
        transcript: SessionGoalController.messagesToTranscript(turn.messages),
        stats: {
          turnCount: turn.stats.turnCount,
          tokens: turn.stats.tokens,
        },
      });
      if (outcome.status === "continue" && outcome.continuePrompt) {
        prompt = outcome.continuePrompt;
        goal = await controller.getGoalStatus();
        continue;
      }
      return;
    }
  }

  private async executePromptTurn(
    sessionId: string,
    prompt: string
  ): Promise<{
    messages: ReturnType<AgentLoop["getMessagesSnapshot"]>;
    stats: ReturnType<AgentLoop["getSessionStats"]>;
  }> {
    const agent = await this.createAgent();
    try {
      const restored = await agent.restoreSession(sessionId);
      if (!restored) {
        throw new Error(`session snapshot not found: ${sessionId}`);
      }
      agent.addUserMessage(prompt);
      await agent.run();
      await agent.checkpointSession();
      return {
        messages: agent.getMessagesSnapshot(),
        stats: agent.getSessionStats(),
      };
    } finally {
      await agent.shutdown();
    }
  }

  private async createAgent(): Promise<AgentLoop> {
    const { config } = await loadQlingConfig({});
    applyConfigToProcessEnv(config);

    const staticEnabled: Record<string, boolean> = {};
    for (const [name, cfg] of Object.entries(config.tools)) {
      staticEnabled[name] = cfg.enabled;
    }
    const tools = buildToolRegistry({ staticEnabled });

    const agent = new AgentLoop({
      apiKey: config.llm.api_key || process.env.QLING_LLM_API_KEY || "",
      provider: config.llm.provider,
      endpoint: config.llm.endpoint,
      model: config.llm.model,
      maxIterations: config.runtime.max_steps,
      tools,
      runtime: {
        workspaceDir: config.runtime.workspace_dir || process.cwd(),
        fileCacheDir: config.runtime.file_cache_dir,
        fileStateDir: this.stateDir,
        maxSteps: config.runtime.max_steps,
        parseRetries: config.runtime.parse_retries,
        toolRepeatLimit: config.runtime.tool_repeat_limit,
        timeoutMs: config.runtime.timeout_ms,
      },
    });
    await agent.waitForInit();
    return agent;
  }
}
