import * as fs from "fs/promises";
import { existsSync } from "fs";
import * as path from "path";
import { atomicWriteJson, readJsonWithBackup } from "../persistence/atomic-json.js";
import type { OutcomeContract } from "./outcome-evidence.js";

export const GOAL_HISTORY_MAX = 64;

export type SessionGoalStatus =
  | "active"
  | "achieved"
  | "blocked"
  | "canceled"
  | "cleared"
  | "paused_no_progress"
  | "paused_budget"
  | "paused_infra";
export type PausedGoalStatus = "paused_no_progress" | "paused_budget" | "paused_infra";
export type SessionGoalDecision = "done" | "continue" | "blocked" | "canceled" | "cleared" | "paused" | null;
export type SessionGoalRunner = "session" | "daemon";

export interface GoalHistoryEntry {
  at: number;
  reason: string;
  fingerprint: string;
}

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
  outcomeContract?: OutcomeContract;
  evidenceIds?: string[];
  blockingCondition?: string;
  attemptedActions?: string[];
  history?: GoalHistoryEntry[];
  stallStreak?: number;
  lastFingerprint?: string | null;
  evaluatorErrorStreak?: number;
}

export interface SessionGoalManagerOptions {
  stateDir: string;
  sessionId: string;
  clock?: () => number;
}

const KNOWN_GOAL_STATUSES = new Set<SessionGoalStatus>([
  "active",
  "achieved",
  "blocked",
  "canceled",
  "cleared",
  "paused_no_progress",
  "paused_budget",
  "paused_infra",
]);

const KNOWN_DECISIONS = new Set<Exclude<SessionGoalDecision, null>>([
  "done",
  "continue",
  "blocked",
  "canceled",
  "cleared",
  "paused",
]);

export function isPausedGoalStatus(status: unknown): status is PausedGoalStatus {
  return status === "paused_no_progress" || status === "paused_budget" || status === "paused_infra";
}

function isKnownGoalStatus(status: unknown): status is SessionGoalStatus {
  return typeof status === "string" && KNOWN_GOAL_STATUSES.has(status as SessionGoalStatus);
}

function cloneGoal(goal: SessionGoalState | null): SessionGoalState | null {
  return goal ? structuredClone(goal) : null;
}

function sanitizeHistory(value: unknown): GoalHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: GoalHistoryEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Partial<GoalHistoryEntry>;
    if (typeof entry.reason !== "string" || typeof entry.fingerprint !== "string") continue;
    entries.push({
      at: typeof entry.at === "number" ? entry.at : 0,
      reason: entry.reason,
      fingerprint: entry.fingerprint,
    });
  }
  return entries.slice(-GOAL_HISTORY_MAX);
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
    options: { runner?: SessionGoalRunner; pending?: boolean; contract?: OutcomeContract } = {}
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
      history: [],
      stallStreak: 0,
      lastFingerprint: null,
      evaluatorErrorStreak: 0,
      ...(options.contract ? { outcomeContract: structuredClone(options.contract) } : {}),
    };
    await this.saveGoal();
    return cloneGoal(this.goal)!;
  }

  async markEvaluation(result: {
    done: boolean;
    reason: string;
    turnCount: number;
    tokens: number;
    fingerprint?: string;
    stallStreak?: number;
    evaluatorErrorStreak?: number;
  }): Promise<SessionGoalState> {
    const goal = this.getGoalOrThrow();
    this.assertNotPaused(goal);
    const now = this.clock();
    goal.updatedAt = now;
    goal.evaluatedTurns += 1;
    goal.lastReason = result.reason;
    goal.lastDecision = result.done ? "done" : "continue";
    goal.pending = goal.runner === "daemon" ? !result.done : false;
    goal.evaluatorErrorStreak = result.evaluatorErrorStreak ?? 0;
    if (result.stallStreak !== undefined) goal.stallStreak = result.stallStreak;
    if (result.fingerprint) {
      goal.lastFingerprint = result.fingerprint;
      this.appendHistory(goal, result.reason, result.fingerprint);
    }
    if (result.done) {
      goal.status = "achieved";
      goal.achievedAt = now;
    }
    await this.saveGoal();
    return cloneGoal(goal)!;
  }

  async noteEvaluatorFailure(input: { reason: string; fingerprint: string }): Promise<SessionGoalState> {
    const goal = this.getGoalOrThrow();
    this.assertNotPaused(goal);
    goal.evaluatorErrorStreak = (goal.evaluatorErrorStreak ?? 0) + 1;
    goal.updatedAt = this.clock();
    goal.lastReason = input.reason;
    goal.lastDecision = null;
    this.appendHistory(goal, input.reason, input.fingerprint);
    await this.saveGoal();
    return cloneGoal(goal)!;
  }

  async pauseGoal(
    status: PausedGoalStatus,
    input: {
      reason: string;
      fingerprint: string;
      stallStreak?: number;
      evaluatorErrorStreak?: number;
      baselineTurns?: number;
      baselineTokens?: number;
    }
  ): Promise<SessionGoalState> {
    const goal = this.getGoalOrThrow();
    this.assertNotPaused(goal);
    goal.status = status;
    goal.pending = false;
    goal.updatedAt = this.clock();
    goal.lastReason = input.reason;
    goal.lastDecision = "paused";
    if (input.stallStreak !== undefined) goal.stallStreak = input.stallStreak;
    if (input.evaluatorErrorStreak !== undefined) goal.evaluatorErrorStreak = input.evaluatorErrorStreak;
    if (input.baselineTurns !== undefined) goal.baselineTurns = input.baselineTurns;
    if (input.baselineTokens !== undefined) goal.baselineTokens = input.baselineTokens;
    if (status !== "paused_infra") goal.lastFingerprint = input.fingerprint;
    this.appendHistory(goal, input.reason, input.fingerprint);
    await this.saveGoal();
    return cloneGoal(goal)!;
  }

  async resumeGoal(): Promise<SessionGoalState> {
    const goal = this.getGoalOrThrow();
    if (!isPausedGoalStatus(goal.status)) {
      throw new Error(`goal status ${goal.status} cannot be resumed`);
    }
    goal.status = "active";
    goal.pending = goal.runner === "daemon";
    goal.stallStreak = 0;
    goal.evaluatorErrorStreak = 0;
    goal.updatedAt = this.clock();
    goal.lastReason = "goal_resumed";
    goal.lastDecision = null;
    await this.saveGoal();
    return cloneGoal(goal)!;
  }

  async markBlocked(input: {
    reason: string;
    evidenceIds?: string[];
    attemptedActions?: string[];
  }): Promise<SessionGoalState> {
    const goal = this.getGoalOrThrow();
    goal.status = "blocked";
    goal.pending = false;
    goal.updatedAt = this.clock();
    goal.lastReason = input.reason;
    goal.lastDecision = "blocked";
    goal.blockingCondition = input.reason;
    goal.evidenceIds = [...(input.evidenceIds ?? [])];
    goal.attemptedActions = [...(input.attemptedActions ?? [])];
    await this.saveGoal();
    return cloneGoal(goal)!;
  }

  async attachEvidence(evidenceIds: string[]): Promise<SessionGoalState> {
    const goal = this.getGoalOrThrow();
    goal.evidenceIds = [...evidenceIds];
    goal.updatedAt = this.clock();
    await this.saveGoal();
    return cloneGoal(goal)!;
  }

  async markCanceled(reason: string): Promise<SessionGoalState> {
    const goal = this.getGoalOrThrow();
    goal.status = "canceled";
    goal.pending = false;
    goal.updatedAt = this.clock();
    goal.clearedAt = goal.updatedAt;
    goal.lastReason = reason;
    goal.lastDecision = "canceled";
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
        history: [],
        stallStreak: 0,
        lastFingerprint: null,
        evaluatorErrorStreak: 0,
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

  private assertNotPaused(goal: SessionGoalState): void {
    if (isPausedGoalStatus(goal.status)) {
      throw new Error("paused goal cannot advance without /goal resume");
    }
  }

  private appendHistory(goal: SessionGoalState, reason: string, fingerprint: string): void {
    const history = Array.isArray(goal.history) ? goal.history : [];
    history.push({ at: this.clock(), reason, fingerprint });
    goal.history = history.slice(-GOAL_HISTORY_MAX);
  }

  private async loadGoal(): Promise<void> {
    const backupFile = `${this.stateFile}.bak`;
    const primaryExists = existsSync(this.stateFile);
    const backupExists = existsSync(backupFile);
    if (!primaryExists && !backupExists) return;

    if (!primaryExists && backupExists) {
      try {
        const parsed = JSON.parse(await fs.readFile(backupFile, "utf-8")) as unknown;
        const accepted = this.acceptSnapshot(parsed);
        this.goal = accepted.goal;
        if (accepted.persist) await this.saveGoal();
        return;
      } catch {
        this.goal = this.failClosedGoal("goal snapshot unreadable");
        await this.saveGoal();
        return;
      }
    }

    const loaded = await readJsonWithBackup<unknown>(this.stateFile);
    if (!loaded) {
      this.goal = this.failClosedGoal("goal snapshot unreadable");
      await this.saveGoal();
      return;
    }
    const accepted = this.acceptSnapshot(loaded.value);
    this.goal = accepted.goal;
    if (accepted.persist || loaded.source === "backup") await this.saveGoal();
  }

  private acceptSnapshot(value: unknown): { goal: SessionGoalState; persist: boolean } {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { goal: this.failClosedGoal("goal snapshot unreadable"), persist: true };
    }
    const parsed = value as Partial<SessionGoalState>;
    if (!isKnownGoalStatus(parsed.status) || (parsed.status === "active" && typeof parsed.condition !== "string")) {
      const reason = isKnownGoalStatus(parsed.status)
        ? "active goal snapshot is missing a condition"
        : `unknown or corrupt goal status: ${String(parsed.status)}`;
      return { goal: this.failClosedGoal(reason, parsed), persist: true };
    }
    return { goal: this.withDefaults(parsed, parsed.status), persist: false };
  }

  private failClosedGoal(reason: string, partial: Partial<SessionGoalState> = {}): SessionGoalState {
    const goal = this.withDefaults(partial, "paused_infra");
    goal.pending = false;
    goal.lastReason = reason;
    goal.lastDecision = "paused";
    goal.updatedAt = this.clock();
    return goal;
  }

  private withDefaults(parsed: Partial<SessionGoalState>, status: SessionGoalStatus): SessionGoalState {
    const now = this.clock();
    const decision = KNOWN_DECISIONS.has(parsed.lastDecision as Exclude<SessionGoalDecision, null>)
      ? parsed.lastDecision ?? null
      : null;
    return {
      condition: typeof parsed.condition === "string" ? parsed.condition : "",
      status,
      runner: parsed.runner === "daemon" ? "daemon" : "session",
      pending: typeof parsed.pending === "boolean" ? parsed.pending : false,
      createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : now,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : now,
      ...(typeof parsed.achievedAt === "number" ? { achievedAt: parsed.achievedAt } : {}),
      ...(typeof parsed.clearedAt === "number" ? { clearedAt: parsed.clearedAt } : {}),
      baselineTurns: typeof parsed.baselineTurns === "number" ? parsed.baselineTurns : 0,
      baselineTokens: typeof parsed.baselineTokens === "number" ? parsed.baselineTokens : 0,
      evaluatedTurns: typeof parsed.evaluatedTurns === "number" ? parsed.evaluatedTurns : 0,
      lastReason: typeof parsed.lastReason === "string" ? parsed.lastReason : null,
      lastDecision: decision,
      ...(parsed.outcomeContract && typeof parsed.outcomeContract === "object"
        ? { outcomeContract: parsed.outcomeContract }
        : {}),
      ...(Array.isArray(parsed.evidenceIds)
        ? { evidenceIds: parsed.evidenceIds.filter((item): item is string => typeof item === "string") }
        : {}),
      ...(typeof parsed.blockingCondition === "string" ? { blockingCondition: parsed.blockingCondition } : {}),
      ...(Array.isArray(parsed.attemptedActions)
        ? { attemptedActions: parsed.attemptedActions.filter((item): item is string => typeof item === "string") }
        : {}),
      history: sanitizeHistory(parsed.history),
      stallStreak: typeof parsed.stallStreak === "number" ? parsed.stallStreak : 0,
      lastFingerprint: typeof parsed.lastFingerprint === "string" ? parsed.lastFingerprint : null,
      evaluatorErrorStreak: typeof parsed.evaluatorErrorStreak === "number" ? parsed.evaluatorErrorStreak : 0,
    };
  }

  private async saveGoal(): Promise<void> {
    await atomicWriteJson(this.stateFile, this.goal, { backup: true });
  }
}
