// ============================================================
// Agent 主循环：外层 transport 恢复 + 内层 turn 迭代（从 AgentLoop 抽出）
// ============================================================

import {
  resolveRoundTokenUsage,
  type ChatUsage,
  type TokenUsageSource,
} from "../token-usage.js";
import type { Message, RawToolCall, ToolCall, ToolDefinition } from "../types.js";
import type { ToolPipeline } from "../pipeline/hooks.js";
import type { GuardConfig } from "../config.js";
import type { Channel } from "../channels/types.js";
import type { ApprovalGate } from "../guard/approval.js";
import type { KnowledgeAgentAdapter } from "../knowledge-agent.js";
import type { MemoryStore } from "../memory.js";
import type { WorkflowRuntime } from "../workflow-runtime.js";
import type { ContextCompactor } from "../context-compactor.js";
import type { VerificationAgent } from "../pipeline/verification.js";
import type { ExecutionEventBus } from "../execution/event-bus.js";
import type { RecoveryController } from "../execution/recovery-controller.js";
import type { FailureClassification, RecoveryState } from "../execution/types.js";
import { classifyFailure } from "../execution/failure-classifier.js";
import {
  executePreparedTools,
  prepareToolCalls,
  type ReflectionDecision,
} from "./tool-orchestrator.js";
import { runWriteToolVerification } from "../execution/verification-loop.js";
import type { LlmChatResponse } from "../providers/llm-client.js";
import { findLastUserMessageContent } from "./system-prompt.js";

export interface TurnTelemetry {
  turn: number;
  toolCalls: number;
  toolFailures: number;
}

export interface TokenCounters {
  sessionTokens: number;
  sessionPromptTokens: number;
  sessionCompletionTokens: number;
  tokenUsageSource: TokenUsageSource;
}

export function applyProviderUsage(
  counters: TokenCounters,
  usage: ChatUsage | undefined
): TokenCounters {
  const tokenUsage = resolveRoundTokenUsage(usage);
  if (tokenUsage.source !== "provider") return counters;
  return {
    sessionTokens: counters.sessionTokens + tokenUsage.tokens,
    sessionPromptTokens: counters.sessionPromptTokens + tokenUsage.promptTokens,
    sessionCompletionTokens: counters.sessionCompletionTokens + tokenUsage.completionTokens,
    tokenUsageSource: "provider",
  };
}

export function logTurnTelemetry(
  metrics: TurnTelemetry,
  totals: {
    toolCallTotal: number;
    toolFailureTotal: number;
    compactionCount: number;
    retryCountTotal: number;
    format: "text" | "json";
  }
): { toolCallTotal: number; toolFailureTotal: number } {
  const toolCallTotal = totals.toolCallTotal + metrics.toolCalls;
  const toolFailureTotal = totals.toolFailureTotal + metrics.toolFailures;
  const turnFailureRate =
    metrics.toolCalls === 0 ? 0 : Math.round((metrics.toolFailures / metrics.toolCalls) * 100);
  const totalFailureRate =
    toolCallTotal === 0 ? 0 : Math.round((toolFailureTotal / toolCallTotal) * 100);

  if (totals.format === "json") {
    console.error(
      JSON.stringify({
        type: "observability",
        turn: metrics.turn,
        toolCalls: metrics.toolCalls,
        turnFailureRate,
        totalFailureRate,
        compactions: totals.compactionCount,
        retries: totals.retryCountTotal,
      })
    );
  } else {
    console.error(
      "📊 [Obs] turn=" +
        metrics.turn +
        " tools=" +
        metrics.toolCalls +
        " turnFailRate=" +
        turnFailureRate +
        "% totalFailRate=" +
        totalFailureRate +
        "% compactions=" +
        totals.compactionCount +
        " retries=" +
        totals.retryCountTotal
    );
  }
  return { toolCallTotal, toolFailureTotal };
}

function toolMessageIsError(messages: Message[], toolCallId: string): boolean {
  for (const m of messages) {
    if (m.tool_call_id !== toolCallId || m.role !== "tool") continue;
    try {
      return Boolean(JSON.parse(m.content!).is_error);
    } catch {
      return false;
    }
  }
  return false;
}

export function distillSuccessfulBashPractices(
  preparedCalls: Array<{ call: ToolCall; immediateResult?: { is_error?: boolean } }>,
  messages: Message[],
  memoryStore: MemoryStore
): void {
  const hasError = preparedCalls.some(
    (p) =>
      Boolean(p.immediateResult?.is_error) ||
      (p.call.id ? toolMessageIsError(messages, p.call.id) : false)
  );
  if (hasError) return;

  const successfulCmds = preparedCalls
    .filter((p) => p.call.name === "bash")
    .map((p) => {
      const args = p.call.arguments as { cmd?: string; command?: string };
      return args.cmd || args.command;
    })
    .filter((cmd): cmd is string => Boolean(cmd));

  if (successfulCmds.length === 0) return;

  const lastUserMsg = findLastUserMessageContent(messages);
  const files = preparedCalls
    .map((p) => {
      const args = p.call.arguments as { path?: string; file?: string };
      return args.path || args.file;
    })
    .filter((f): f is string => Boolean(f));

  memoryStore.addPractice(lastUserMsg.slice(0, 100), successfulCmds, files);
  console.error(`✨ [认知] 已将 ${successfulCmds.length} 条成功指令蒸馏为最佳实践`);
}

export interface InnerLoopHost {
  messages: Message[];
  turnCount: number;
  sessionId: string;
  maxIterations: number;
  toolRepeatLimit: number;
  parseRetries: number;
  verificationCommand: string | null;
  counters: TokenCounters;
  compactionCount: number;
  toolCallTotal: number;
  toolFailureTotal: number;
  retryCountTotal: number;
  loggingFormat: "text" | "json";
  activeRunId?: string;

  compactor: ContextCompactor;
  pipeline: ToolPipeline;
  tools: ToolDefinition[];
  guardConfig: GuardConfig;
  channel: Channel | null;
  approvalGate: ApprovalGate;
  knowledgeAdapter: KnowledgeAgentAdapter;
  memoryStore: MemoryStore;
  workspaceDir: string;
  workflowRuntime: WorkflowRuntime;
  executionEventBus: ExecutionEventBus;
  recoveryController: RecoveryController;
  verifier: VerificationAgent;

  buildSystemPrompt: () => Promise<string>;
  chat: (systemPrompt: string, overrides?: Record<string, unknown>) => Promise<LlmChatResponse>;
  emit: (event: string, ...args: unknown[]) => void;
  runVerificationCommand: (cmd: string) => Promise<{ code: number; stdout: string; stderr: string }>;
  getRecoveryState: () => RecoveryState | null;
  reflectiveThink: (tc: ToolCall) => Promise<{ decision: ReflectionDecision; reason: string }>;
  checkAutoDream: () => Promise<void>;
}

/**
 * Inner maxIterations loop: compact → prompt → chat → tools → verify.
 * Mutates host.messages / counters / turnCount in place.
 */
export async function runInnerIterationLoop(host: InnerLoopHost): Promise<string> {
  const toolSignatureCounts = new Map<string, number>();

  for (let i = 0; i < host.maxIterations; i++) {
    host.turnCount++;
    const runId = host.activeRunId ?? `run_untracked_${host.turnCount}`;
    const attemptId = `attempt_${runId}_${host.turnCount}`;
    host.executionEventBus.startAttempt({ runId, sessionId: host.sessionId, attemptId });

    const lastUserMsg = findLastUserMessageContent(host.messages);

    // 默认自动压缩：上下文估计超阈值时摘要旧消息并保留最近轮
    {
      const { resolveAutoCompactConfig } = await import("../session/compact-auto.js");
      const autoCfg = resolveAutoCompactConfig();
      if (autoCfg.enabled && host.compactor.needsCompaction(host.messages)) {
        const beforeCount = host.messages.length;
        console.error("\n📦 上下文压缩中...（" + beforeCount + " 条消息）");
        const compacted = await host.compactor.compact(
          host.messages,
          autoCfg.recentKeep
        );
        host.messages.splice(0, host.messages.length, ...compacted);
        host.compactionCount++;
        const afterCount = host.messages.length;
        console.error("📦 压缩完成 → " + afterCount + " 条消息\n");
        host.emit("context_compacted", {
          beforeCount,
          afterCount,
          auto: true,
        });
      }
    }

    const conflicts = host.compactor.scanConflicts(host.messages);
    if (conflicts.length > 0) {
      console.error("⚠️ 检测到 " + conflicts.length + " 处指令冲突");
    }
    const poison = host.compactor.scanPoison(host.messages);
    if (poison.length > 0) {
      console.error("🚨 检测到 " + poison.length + " 处可能的提示注入");
    }

    const systemPrompt = await host.buildSystemPrompt();

    if (process.env.QLING_FEATURES_WORKFLOW_RUNTIME === "true") {
      await host.workflowRuntime.updateContext(host.messages);
    }

    const { content, tool_calls, usage } = await host.chat(systemPrompt);
    host.counters = applyProviderUsage(host.counters, usage);
    host.messages.push({ role: "assistant", content, tool_calls });
    host.emit("thinking", content || "正在思考...");

    if (!tool_calls || tool_calls.length === 0) {
      host.knowledgeAdapter.onAssistantMessage(content);
      await host.checkAutoDream();
      await host.knowledgeAdapter.onTurnEnd(host.turnCount);
      const totals = logTurnTelemetry(
        { turn: host.turnCount, toolCalls: 0, toolFailures: 0 },
        {
          toolCallTotal: host.toolCallTotal,
          toolFailureTotal: host.toolFailureTotal,
          compactionCount: host.compactionCount,
          retryCountTotal: host.retryCountTotal,
          format: host.loggingFormat,
        }
      );
      host.toolCallTotal = totals.toolCallTotal;
      host.toolFailureTotal = totals.toolFailureTotal;
      host.executionEventBus.completeAttempt(runId, "succeeded");
      return content;
    }

    console.error("\n🔧 执行 " + tool_calls.length + " 个工具...\n");
    const preparedCalls = prepareToolCalls(tool_calls as RawToolCall[], {
      parseRetries: host.parseRetries,
      toolRepeatLimit: host.toolRepeatLimit,
      signatureCounts: toolSignatureCounts,
    });
    const { turnToolCalls, turnToolFailures } = await executePreparedTools(
      {
        pipeline: host.pipeline,
        tools: host.tools,
        guardConfig: host.guardConfig,
        channel: host.channel,
        approvalGate: host.approvalGate,
        knowledgeAdapter: host.knowledgeAdapter,
        memoryStore: host.memoryStore,
        workspaceDir: host.workspaceDir,
        workflowRuntime: host.workflowRuntime,
        executionEventBus: host.executionEventBus,
        emit: host.emit,
        reflectiveThink: host.reflectiveThink,
      },
      {
        preparedCalls,
        messages: host.messages,
        runId,
        attemptId,
      }
    );

    const verifyOutcome = await runWriteToolVerification(preparedCalls, {
      verificationCommand: host.verificationCommand,
      runCommand: host.runVerificationCommand,
      recoveryController: host.recoveryController,
      executionEventBus: host.executionEventBus,
      emit: host.emit,
      getRecoveryState: host.getRecoveryState,
      verifier: host.verifier,
      messages: host.messages,
      runId,
    });
    if (verifyOutcome.kind === "pause") {
      return verifyOutcome.text;
    }
    if (verifyOutcome.kind === "recover") {
      host.messages.push({ role: "user", content: verifyOutcome.userMessage });
      host.emit(
        "repair",
        verifyOutcome.failureMessage,
        verifyOutcome.strategy,
        verifyOutcome.strategyAttempts
      );
      host.executionEventBus.completeAttempt(runId, "recovering");
      continue;
    }

    await host.checkAutoDream();

    if (host.turnCount > 0) {
      distillSuccessfulBashPractices(preparedCalls, host.messages, host.memoryStore);
    }

    host.memoryStore.addConversationTurn("user", lastUserMsg);
    host.memoryStore.addConversationTurn("assistant", content);
    host.knowledgeAdapter.onAssistantMessage(content);
    await host.knowledgeAdapter.onTurnEnd(host.turnCount);
    const totals = logTurnTelemetry(
      { turn: host.turnCount, toolCalls: turnToolCalls, toolFailures: turnToolFailures },
      {
        toolCallTotal: host.toolCallTotal,
        toolFailureTotal: host.toolFailureTotal,
        compactionCount: host.compactionCount,
        retryCountTotal: host.retryCountTotal,
        format: host.loggingFormat,
      }
    );
    host.toolCallTotal = totals.toolCallTotal;
    host.toolFailureTotal = totals.toolFailureTotal;
    host.executionEventBus.completeAttempt(runId, "succeeded");
  }

  return "⚠️ 达到最大迭代次数，任务未完成。";
}

export interface OuterLoopHost {
  sessionId: string;
  activeRun: { runId: string; sessionId: string; originalTask: string; startedAt: number } | null;
  messages: Message[];
  executionEventBus: ExecutionEventBus;
  recoveryController: RecoveryController;
  emit: (event: string, ...args: unknown[]) => void;
  getRecoveryState: () => RecoveryState | null;
  formatRecoveryPause: (reason: string, next: string) => string;
  applyRecoveryStrategy: (
    failure: FailureClassification,
    strategy?: string
  ) => Promise<void>;
  executeInner: () => Promise<string>;
  setActiveRun: (
    run: { runId: string; sessionId: string; originalTask: string; startedAt: number } | null
  ) => void;
}

/**
 * Outer loop: start run, handle provider transport retries + recovery strategy.
 */
export async function runOuterAgentLoop(host: OuterLoopHost): Promise<string> {
  const recoveryState = host.getRecoveryState();
  const resumable = host.activeRun && recoveryState?.status === "recovering";
  const originalTask = resumable
    ? host.activeRun!.originalTask
    : findLastUserMessageContent(host.messages);
  const runId = resumable
    ? host.activeRun!.runId
    : `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

  if (!resumable) {
    host.setActiveRun({
      runId,
      sessionId: host.sessionId,
      originalTask,
      startedAt: Date.now(),
    });
    host.recoveryController.startRun({ runId, sessionId: host.sessionId, originalTask });
    host.executionEventBus.startRun({ runId, sessionId: host.sessionId });
  }

  let transportAttempts = 0;
  while (true) {
    try {
      const response = await host.executeInner();
      if (host.getRecoveryState()?.status === "paused") return response;
      host.executionEventBus.completeRun(runId, "succeeded");
      host.setActiveRun(null);
      return response;
    } catch (error) {
      host.executionEventBus.completeAttempt(runId, "failed");
      const failure = classifyFailure(error, { provider: true });
      if (failure.category === "provider_transient" && transportAttempts < 3) {
        transportAttempts++;
        const delay =
          Math.min(4_000, 250 * 2 ** (transportAttempts - 1)) + Math.floor(Math.random() * 100);
        host.executionEventBus.emit({
          runId,
          sessionId: host.sessionId,
          type: "recovery_started",
          status: "recovering",
          stage: "provider",
          category: failure.category,
          fingerprint: failure.fingerprint,
          recoveryAction: "transport_retry",
        });
        host.emit("repair", failure.message, "provider transport retry", transportAttempts);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      const decision = host.recoveryController.recordFailure(failure, {});
      const state = host.recoveryController.getRecoveryState();
      host.executionEventBus.emit({
        runId,
        sessionId: host.sessionId,
        type: "failure",
        status: decision.action === "pause" ? "paused" : "recovering",
        stage: "agent",
        category: decision.category,
        fingerprint: failure.fingerprint,
        recoveryAction: decision.recommendedStrategy ?? decision.action,
      });
      host.emit("recovery_paused", state, decision);
      if (decision.action === "pause") {
        return host.formatRecoveryPause(failure.message, decision.reason);
      }
      await host.applyRecoveryStrategy(failure, decision.recommendedStrategy);
      host.emit(
        "repair",
        failure.message,
        decision.recommendedStrategy ?? decision.reason,
        state.strategyAttempts
      );
      continue;
    }
  }
}
