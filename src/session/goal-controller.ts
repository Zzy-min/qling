import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { Message } from "../types.js";
import { GoalEvaluator, type GoalEvaluationResult, type GoalEvaluatorError } from "./goal-evaluator.js";
import {
  SessionGoalManager,
  type SessionGoalRunner,
  type SessionGoalState,
  type SessionGoalStatus,
} from "./session-goal-manager.js";
import {
  evaluateOutcomeContract,
  type EvidenceRecord,
  type OutcomeContract,
} from "./outcome-evidence.js";
import { detectPrematureStop } from "./premature-stop.js";

export const GOAL_PREMATURE_STOP_EVENT = "goal_premature_stop";
const EVALUATOR_ERROR_PAUSE_AFTER = 2;

export interface GoalPrematureStopEvent {
  pattern: string;
  condition: string;
}

export interface GoalControllerAfterTurnInput {
  transcript: string;
  stats: {
    turnCount: number;
    tokens: number;
  };
  evidence?: EvidenceRecord[];
  now?: number;
}

export interface GoalControllerAfterTurnResult {
  status: "idle" | "continue" | "achieved" | "blocked" | "cleared" | "paused" | "evaluator_error";
  reason: string | null;
  continuePrompt: string | null;
}

export interface SessionGoalControllerOptions {
  manager: SessionGoalManager;
  evaluator?: Pick<GoalEvaluator, "evaluate">;
  maxAutoTurns?: number;
  stallThreshold?: number;
  /** Test seam. Production callers leave this unset and use QLING_FEATURES_EVIDENCE_GOALS. */
  evidenceGoals?: boolean;
  runner?: SessionGoalRunner;
}

export function normalizeGapReason(reason: string): string {
  return reason
    .replace(/:\d+(?::\d+)?\b/g, "")
    .replace(/\d+/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

export function gapFingerprint(reason: string): string {
  return createHash("sha1").update(normalizeGapReason(reason)).digest("hex").slice(0, 12);
}

function evaluationFailure(result: GoalEvaluationResult): GoalEvaluatorError | null {
  if (result.error) return result.error;
  const reason = result.reason ?? "";
  if (/goal evaluator/i.test(reason) && /api key/i.test(reason)) return "no_key";
  if (/不可解析|unparseable/i.test(reason)) return "unparseable";
  return null;
}

function thrownEvaluatorReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";
  const kind: GoalEvaluatorError = name === "AbortError" || /timeout|aborted/i.test(message)
    ? "timeout"
    : /api key/i.test(message)
      ? "no_key"
      : /parse|json/i.test(message)
        ? "unparseable"
        : "network";
  return message ? `evaluator_error:${kind}: ${message}` : `evaluator_error:${kind}`;
}

export class SessionGoalController extends EventEmitter {
  private readonly manager: SessionGoalManager;
  private readonly evaluator: Pick<GoalEvaluator, "evaluate">;
  private readonly maxAutoTurns: number;
  private readonly stallThreshold: number | undefined;
  private readonly evidenceGoals: boolean | undefined;
  private readonly runner: SessionGoalRunner;

  constructor(options: SessionGoalControllerOptions) {
    super();
    this.manager = options.manager;
    this.evaluator = options.evaluator ?? new GoalEvaluator();
    this.maxAutoTurns = options.maxAutoTurns ?? Number(process.env.QLING_GOAL_MAX_AUTO_TURNS ?? "12");
    this.stallThreshold = options.stallThreshold;
    this.evidenceGoals = options.evidenceGoals;
    this.runner = options.runner ?? "session";
  }

  async init(): Promise<void> {
    await this.manager.init();
  }

  async setGoal(
    condition: string,
    stats: { turnCount: number; tokens: number },
    options: { runner?: SessionGoalRunner; pending?: boolean; contract?: OutcomeContract } = {}
  ): Promise<SessionGoalState> {
    return this.manager.setGoal(condition, stats, {
      runner: options.runner ?? this.runner,
      pending: options.pending ?? false,
      ...(options.contract ? { contract: options.contract } : {}),
    });
  }

  async clearGoal(reason: string): Promise<SessionGoalState> {
    return this.manager.clearGoal(reason);
  }

  async resumeGoal(): Promise<SessionGoalState> {
    return this.manager.resumeGoal();
  }

  async getGoalStatus(): Promise<SessionGoalState | null> {
    return this.manager.getGoalStatus();
  }

  buildInitialPrompt(condition: string): string {
    return `当前激活目标条件：${condition}\n请立即开始工作，直到条件满足。每轮都优先做最有效的下一步，并把可验证证据写入对话。`;
  }

  buildContinuationPrompt(condition: string, reason: string): string {
    return `目标条件：${condition}\n上一轮 goal 评估：${reason}\n请继续推进，优先执行最有效的下一步，并把可验证证据写入对话。`;
  }

  buildPrematureStopPrompt(condition: string, pattern: string): string {
    return `目标条件：${condition}\n检测到过早放弃（${pattern}）。不要交还给用户，先尝试其他方案，优先执行另一个可验证的下一步，并把证据写入对话。`;
  }

  async afterTurn(input: GoalControllerAfterTurnInput): Promise<GoalControllerAfterTurnResult> {
    const active = this.manager.getActiveGoal(this.runner);
    if (!active) {
      return { status: "idle", reason: null, continuePrompt: null };
    }

    const autoTurnsSpent = Math.max(0, input.stats.turnCount - active.baselineTurns);
    if (autoTurnsSpent > this.maxAutoTurns) {
      if (this.evidenceGoalsEnabled()) {
        const blocked = await this.manager.markBlocked({
          reason: `max auto turns reached (${this.maxAutoTurns})`,
        });
        return { status: "blocked", reason: blocked.lastReason, continuePrompt: null };
      }
      const reason = `max auto turns reached (${this.maxAutoTurns})`;
      const paused = await this.manager.pauseGoal("paused_budget", {
        reason,
        fingerprint: gapFingerprint(reason),
        baselineTurns: input.stats.turnCount,
        baselineTokens: input.stats.tokens,
      });
      return { status: "paused", reason: paused.lastReason, continuePrompt: null };
    }

    if (active.outcomeContract) {
      const evidence = input.evidence ?? [];
      const outcome = evaluateOutcomeContract(active.outcomeContract, evidence, { now: input.now });
      if (outcome.status === "achieved") {
        await this.manager.markEvaluation({
          done: true,
          reason: outcome.reason,
          turnCount: input.stats.turnCount,
          tokens: input.stats.tokens,
        });
        await this.manager.attachEvidence(
          evidence.filter((item) => item.verdict === "pass").map((item) => item.id)
        );
        return { status: "achieved", reason: outcome.reason, continuePrompt: null };
      }
      if (outcome.status === "blocked") {
        const blocked = await this.manager.markBlocked({
          reason: outcome.reason,
          evidenceIds: evidence.map((item) => item.id),
        });
        return { status: "blocked", reason: blocked.lastReason, continuePrompt: null };
      }
      const updated = await this.manager.markEvaluation({
        done: false,
        reason: outcome.reason,
        turnCount: input.stats.turnCount,
        tokens: input.stats.tokens,
      });
      return {
        status: "continue",
        reason: outcome.reason,
        continuePrompt: this.continuationFor(updated.condition, outcome.reason, input.transcript, updated.status),
      };
    }

    let evaluation: GoalEvaluationResult;
    try {
      evaluation = await this.evaluator.evaluate({
        condition: active.condition,
        transcript: input.transcript,
      });
    } catch (error) {
      return this.recordEvaluatorFailure(active, thrownEvaluatorReason(error));
    }

    if (!evaluation || typeof evaluation.done !== "boolean" || typeof evaluation.reason !== "string") {
      return this.recordEvaluatorFailure(active, "goal evaluator 返回了不可解析结果");
    }

    const failure = evaluationFailure(evaluation);
    if (failure) {
      const reason = evaluation.reason.trim() || `evaluator_error:${failure}`;
      return this.recordEvaluatorFailure(active, reason);
    }

    if (evaluation.done) {
      const updated = await this.manager.markEvaluation({
        done: true,
        reason: evaluation.reason,
        turnCount: input.stats.turnCount,
        tokens: input.stats.tokens,
        fingerprint: gapFingerprint(evaluation.reason),
        stallStreak: 1,
        evaluatorErrorStreak: 0,
      });
      return {
        status: "achieved",
        reason: updated.lastReason,
        continuePrompt: null,
      };
    }

    return this.finishUnmet(active, evaluation.reason, input.stats, input.transcript);
  }

  static messagesToTranscript(messages: Message[]): string {
    return messages
      .slice(-40)
      .map((message) => `${message.role}: ${message.content}`)
      .join("\n\n");
  }

  private evidenceGoalsEnabled(): boolean {
    if (this.evidenceGoals !== undefined) return this.evidenceGoals;
    return process.env.QLING_FEATURES_EVIDENCE_GOALS === "true";
  }

  private resolveStallThreshold(): number {
    if (this.stallThreshold !== undefined && Number.isFinite(this.stallThreshold) && this.stallThreshold >= 1) {
      return Math.floor(this.stallThreshold);
    }
    const parsed = Number(process.env.QLING_GOAL_STALL_THRESHOLD ?? "2");
    if (!Number.isFinite(parsed) || parsed < 1) return 2;
    return Math.floor(parsed);
  }

  private async finishUnmet(
    active: SessionGoalState,
    reason: string,
    stats: { turnCount: number; tokens: number },
    transcript: string
  ): Promise<GoalControllerAfterTurnResult> {
    const fingerprint = gapFingerprint(reason);
    const same = active.lastFingerprint != null && active.lastFingerprint === fingerprint;
    const streak = same ? (active.stallStreak ?? 0) + 1 : 1;
    if (streak >= this.resolveStallThreshold()) {
      const paused = await this.manager.pauseGoal("paused_no_progress", {
        reason,
        fingerprint,
        stallStreak: streak,
        evaluatorErrorStreak: 0,
      });
      return { status: "paused", reason: paused.lastReason, continuePrompt: null };
    }
    const updated = await this.manager.markEvaluation({
      done: false,
      reason,
      turnCount: stats.turnCount,
      tokens: stats.tokens,
      fingerprint,
      stallStreak: streak,
      evaluatorErrorStreak: 0,
    });
    return {
      status: "continue",
      reason: updated.lastReason,
      continuePrompt: this.continuationFor(updated.condition, updated.lastReason ?? reason, transcript, updated.status),
    };
  }

  private async recordEvaluatorFailure(
    active: SessionGoalState,
    reason: string
  ): Promise<GoalControllerAfterTurnResult> {
    const streak = (active.evaluatorErrorStreak ?? 0) + 1;
    const fingerprint = gapFingerprint(reason);
    if (streak >= EVALUATOR_ERROR_PAUSE_AFTER) {
      const paused = await this.manager.pauseGoal("paused_infra", {
        reason,
        fingerprint,
        evaluatorErrorStreak: streak,
      });
      return { status: "paused", reason: paused.lastReason, continuePrompt: null };
    }
    const noted = await this.manager.noteEvaluatorFailure({ reason, fingerprint });
    return { status: "evaluator_error", reason: noted.lastReason, continuePrompt: null };
  }

  private continuationFor(
    condition: string,
    reason: string,
    transcript: string,
    goalStatus: SessionGoalStatus
  ): string {
    if (goalStatus === "active") {
      const stop = detectPrematureStop(transcript);
      if (stop) {
        try {
          this.emit(GOAL_PREMATURE_STOP_EVENT, { pattern: stop.pattern, condition } satisfies GoalPrematureStopEvent);
        } catch {
          // Listener failures must not turn a continuation into an evaluator outage.
        }
        return this.buildPrematureStopPrompt(condition, stop.pattern);
      }
    }
    return this.buildContinuationPrompt(condition, reason);
  }
}
