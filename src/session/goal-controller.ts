import { Message } from "../types.js";
import { GoalEvaluator, type GoalEvaluationResult } from "./goal-evaluator.js";
import { SessionGoalManager, type SessionGoalRunner, type SessionGoalState } from "./session-goal-manager.js";

export interface GoalControllerAfterTurnInput {
  transcript: string;
  stats: {
    turnCount: number;
    tokens: number;
  };
}

export interface GoalControllerAfterTurnResult {
  status: "idle" | "continue" | "achieved" | "cleared";
  reason: string | null;
  continuePrompt: string | null;
}

export interface SessionGoalControllerOptions {
  manager: SessionGoalManager;
  evaluator?: Pick<GoalEvaluator, "evaluate">;
  maxAutoTurns?: number;
  runner?: SessionGoalRunner;
}

export class SessionGoalController {
  private readonly manager: SessionGoalManager;
  private readonly evaluator: Pick<GoalEvaluator, "evaluate">;
  private readonly maxAutoTurns: number;
  private readonly runner: SessionGoalRunner;

  constructor(options: SessionGoalControllerOptions) {
    this.manager = options.manager;
    this.evaluator = options.evaluator ?? new GoalEvaluator();
    this.maxAutoTurns = options.maxAutoTurns ?? Number(process.env.QINGLING_GOAL_MAX_AUTO_TURNS ?? "12");
    this.runner = options.runner ?? "session";
  }

  async init(): Promise<void> {
    await this.manager.init();
  }

  async setGoal(
    condition: string,
    stats: { turnCount: number; tokens: number },
    options: { runner?: SessionGoalRunner; pending?: boolean } = {}
  ): Promise<SessionGoalState> {
    return this.manager.setGoal(condition, stats, {
      runner: options.runner ?? this.runner,
      pending: options.pending ?? false,
    });
  }

  async clearGoal(reason: string): Promise<SessionGoalState> {
    return this.manager.clearGoal(reason);
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

  async afterTurn(input: GoalControllerAfterTurnInput): Promise<GoalControllerAfterTurnResult> {
    const active = this.manager.getActiveGoal(this.runner);
    if (!active) {
      return { status: "idle", reason: null, continuePrompt: null };
    }

    const autoTurnsSpent = Math.max(0, input.stats.turnCount - active.baselineTurns);
    if (autoTurnsSpent > this.maxAutoTurns) {
      const cleared = await this.manager.clearGoal(`max auto turns reached (${this.maxAutoTurns})`);
      return {
        status: "cleared",
        reason: cleared.lastReason,
        continuePrompt: null,
      };
    }

    const evaluation = await this.evaluator.evaluate({
      condition: active.condition,
      transcript: input.transcript,
    });

    const updated = await this.manager.markEvaluation({
      done: evaluation.done,
      reason: evaluation.reason,
      turnCount: input.stats.turnCount,
      tokens: input.stats.tokens,
    });

    if (evaluation.done) {
      return {
        status: "achieved",
        reason: updated.lastReason,
        continuePrompt: null,
      };
    }

    return {
      status: "continue",
      reason: updated.lastReason,
      continuePrompt: this.buildContinuationPrompt(updated.condition, updated.lastReason ?? "条件未满足"),
    };
  }

  static messagesToTranscript(messages: Message[]): string {
    return messages
      .slice(-40)
      .map((message) => `${message.role}: ${message.content}`)
      .join("\n\n");
  }
}
