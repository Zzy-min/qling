import * as fs from "fs/promises";
import { existsSync } from "fs";
import * as path from "path";

export type SessionGoalStatus = "active" | "achieved" | "cleared";
export type SessionGoalDecision = "done" | "continue" | "cleared" | null;
export type SessionGoalRunner = "session" | "daemon";

export interface SessionGoalState {
  condition: string;
  status: SessionGoalStatus;
  runner: SessionGoalRunner;
  pending: boolean;
  createdAt: number;
  updatedAt: number;
  achievedAt?: number;
  clearedAt?: number;
  baselineTurns: number;
  baselineTokens: number;
  evaluatedTurns: number;
  lastReason: string | null;
  lastDecision: SessionGoalDecision;
}

export interface SessionGoalManagerOptions {
  stateDir: string;
  sessionId: string;
  clock?: () => number;
}

function cloneGoal(goal: SessionGoalState | null): SessionGoalState | null {
  return goal ? { ...goal } : null;
}

export class SessionGoalManager {
  private readonly goalsDir: string;
  private readonly stateFile: string;
  private readonly clock: () => number;
  private goal: SessionGoalState | null = null;

  constructor(options: SessionGoalManagerOptions) {
    this.goalsDir = path.join(options.stateDir, "session-goals");
    this.stateFile = path.join(this.goalsDir, `${options.sessionId}.json`);
    this.clock = options.clock ?? (() => Date.now());
  }

  async init(): Promise<void> {
    await fs.mkdir(this.goalsDir, { recursive: true });
    await this.loadGoal();
  }

  async setGoal(
    condition: string,
    baseline: { turnCount: number; tokens: number },
    options: { runner?: SessionGoalRunner; pending?: boolean } = {}
  ): Promise<SessionGoalState> {
    const now = this.clock();
    this.goal = {
      condition: condition.trim(),
      status: "active",
      runner: options.runner ?? "session",
      pending: options.pending ?? false,
      createdAt: now,
      updatedAt: now,
      baselineTurns: baseline.turnCount,
      baselineTokens: baseline.tokens,
      evaluatedTurns: 0,
      lastReason: "goal_activated",
      lastDecision: null,
    };
    await this.saveGoal();
    return cloneGoal(this.goal)!;
  }

  async markEvaluation(result: {
    done: boolean;
    reason: string;
    turnCount: number;
    tokens: number;
  }): Promise<SessionGoalState> {
    const goal = this.getGoalOrThrow();
    const now = this.clock();
    goal.updatedAt = now;
    goal.evaluatedTurns += 1;
    goal.lastReason = result.reason;
    goal.lastDecision = result.done ? "done" : "continue";
    goal.pending = goal.runner === "daemon" ? !result.done : false;
    if (result.done) {
      goal.status = "achieved";
      goal.achievedAt = now;
    }
    await this.saveGoal();
    return cloneGoal(goal)!;
  }

  async clearGoal(reason: string): Promise<SessionGoalState> {
    const goal = this.goal;
    const now = this.clock();
    if (!goal) {
      const cleared: SessionGoalState = {
        condition: "",
        status: "cleared",
        runner: "session",
        pending: false,
        createdAt: now,
        updatedAt: now,
        clearedAt: now,
        baselineTurns: 0,
        baselineTokens: 0,
        evaluatedTurns: 0,
        lastReason: reason,
        lastDecision: "cleared",
      };
      this.goal = cleared;
      await this.saveGoal();
      return cloneGoal(cleared)!;
    }

    goal.status = "cleared";
    goal.pending = false;
    goal.updatedAt = now;
    goal.clearedAt = now;
    goal.lastReason = reason;
    goal.lastDecision = "cleared";
    await this.saveGoal();
    return cloneGoal(goal)!;
  }

  async getGoalStatus(): Promise<SessionGoalState | null> {
    await this.loadGoal();
    return cloneGoal(this.goal);
  }

  getActiveGoal(runner?: SessionGoalRunner): SessionGoalState | null {
    if (!this.goal || this.goal.status !== "active") {
      return null;
    }
    if (runner && (this.goal.runner ?? "session") !== runner) {
      return null;
    }
    return cloneGoal(this.goal);
  }

  private getGoalOrThrow(): SessionGoalState {
    if (!this.goal) {
      throw new Error("session goal not found");
    }
    return this.goal;
  }

  private async loadGoal(): Promise<void> {
    if (!existsSync(this.stateFile)) return;
    const raw = await fs.readFile(this.stateFile, "utf-8");
    const parsed = JSON.parse(raw) as SessionGoalState;
    this.goal = {
      ...parsed,
      runner: parsed.runner ?? "session",
      pending: parsed.pending ?? false,
    };
  }

  private async saveGoal(): Promise<void> {
    await fs.writeFile(this.stateFile, JSON.stringify(this.goal, null, 2), "utf-8");
  }
}
