// ============================================================
// Agent 主循环：外层 transport 恢复 + 内层 turn 迭代（从 AgentLoop 抽出）
// ============================================================

import path from "node:path";
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
import type { FailureClassification, RecoveryState, RunOutcome } from "../execution/types.js";
import { classifyFailure } from "../execution/failure-classifier.js";
import {
  executePreparedTools,
  fingerprintToolAction,
  prepareToolCalls,
  type ReflectionDecision,
} from "./tool-orchestrator.js";
import { runWriteToolVerification } from "../execution/verification-loop.js";
import type { LlmChatResponse } from "../providers/llm-client.js";
import { assertSessionLeaseToken } from "../runtime/session-lease.js";
import { findLastUserMessageContent } from "./system-prompt.js";
import type { UsageLedger } from "../usage-ledger.js";
import type { RunCheckpoint, RunCheckpointStore } from "../runtime/run-checkpoint.js";
import type { ToolDispatcher } from "../tools/index.js";
import { RunEfficiencyGuard } from "./run-efficiency.js";
import type { ProgressState } from "./run-efficiency.js";
import type { ProjectProfile } from "../runtime/project-profile.js";
import { upsertSyntheticMessage } from "./synthetic-messages.js";
import { repairHistory } from "../context-history-repair.js";
import { resolveCostBudgetSignal } from "../cost-budget.js";

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
  usage: ChatUsage | undefined,
  ledger?: UsageLedger
): TokenCounters {
  const tokenUsage = resolveRoundTokenUsage(usage);
  if (tokenUsage.source !== "provider") {
    ledger?.markIncomplete("provider_usage_missing");
    return counters;
  }
  ledger?.record({
    promptTokens: tokenUsage.promptTokens,
    completionTokens: tokenUsage.completionTokens,
  });
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
  sessionLeaseToken?: string;
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
  fileStateDir: string;
  ownedPaths?: string[];
  workflowRuntime: WorkflowRuntime;
  executionEventBus: ExecutionEventBus;
  recoveryController: RecoveryController;
  verifier: VerificationAgent;
  usageLedger?: UsageLedger;
  dispatchTool?: ToolDispatcher;
  recordRuntimeTool?: import("../agent/tool-orchestrator.js").ToolOrchestratorDeps["recordRuntimeTool"];
  checkpointStore?: RunCheckpointStore;
  initialProgressState?: ProgressState;
  deterministicVerificationAvailable?: boolean;
  requireWorkspaceMutation?: boolean;
  projectProfile?: ProjectProfile;

  buildSystemPrompt: () => Promise<string>;
  chat: (systemPrompt: string, overrides?: Record<string, unknown>) => Promise<LlmChatResponse>;
  emit: (event: string, ...args: unknown[]) => void;
  runVerificationCommand: (cmd: string, runtime?: "native" | "wsl") => Promise<{ code: number; stdout: string; stderr: string }>;
  getRecoveryState: () => RecoveryState | null;
  reflectiveThink: (tc: ToolCall) => Promise<{ decision: ReflectionDecision; reason: string }>;
  checkAutoDream: () => Promise<void>;
  /** Persist messages after a tool batch. Must not be awaited by the loop. */
  checkpointSession?: () => Promise<unknown>;
  /**
   * Directory for the mid-turn snapshot. Empty or relative values must not be
   * resolved against cwd. Falls back to fileStateDir when omitted.
   */
  checkpointStateDir?: string | null;
}

const checkpointSkipNoted = { done: false };

/** Absolute state dirs only. Empty/relative input is not joined onto process.cwd(). */
export function canWriteMidTurnCheckpoint(stateDir: string | null | undefined): boolean {
  if (typeof stateDir !== "string") return false;
  const trimmed = stateDir.trim();
  if (!trimmed || !path.isAbsolute(trimmed)) return false;
  return true;
}

function noteMidTurnCheckpointSkipped(stateDir: string | null | undefined): void {
  if (checkpointSkipNoted.done) return;
  checkpointSkipNoted.done = true;
  const shown = stateDir === undefined ? "<unset>" : JSON.stringify(stateDir);
  console.debug(`[checkpoint] skip mid-turn snapshot; stateDir is not an absolute directory (${shown})`);
}

const checkpointWarningState = { warned: false };

export function resolveCheckpointMinIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.QLING_CHECKPOINT_MIN_INTERVAL_MS;
  if (raw === undefined || String(raw).trim() === "") return 2000;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return 2000;
  return value;
}

/**
 * After each tool batch, snapshot the session through the caller's save
 * (atomic-json queue). Never awaits the write and warns at most once.
 */
export function createThrottledSessionCheckpoint(options: {
  save: () => Promise<unknown>;
  minIntervalMs: number;
  now?: () => number;
  warn?: (message: string) => void;
  warningState?: { warned: boolean };
  schedule?: (callback: () => void, delayMs: number) => { cancel(): void };
}): { afterToolBatch(): void } {
  const warningState = options.warningState ?? checkpointWarningState;
  const now = () => (options.now ?? Date.now)();
  const schedule = options.schedule ?? ((callback: () => void, delayMs: number) => {
    const timer = setTimeout(callback, delayMs);
    if (typeof timer.unref === "function") timer.unref();
    return { cancel: () => clearTimeout(timer) };
  });
  let lastStartedAt = Number.NEGATIVE_INFINITY;
  let pending: { cancel(): void } | null = null;

  const warnOnce = (error: unknown) => {
    if (warningState.warned) return;
    warningState.warned = true;
    const message = error instanceof Error ? error.message : String(error);
    (options.warn ?? ((line: string) => console.warn(line)))(
      `[checkpoint] 会话检查点写入失败（后续相同失败不再重复告警）: ${message}`,
    );
  };

  const run = () => {
    lastStartedAt = now();
    try {
      void Promise.resolve(options.save()).catch(warnOnce);
    } catch (error) {
      warnOnce(error);
    }
  };

  return {
    afterToolBatch() {
      const elapsed = now() - lastStartedAt;
      if (elapsed >= options.minIntervalMs) {
        pending?.cancel();
        pending = null;
        run();
        return;
      }
      if (pending) return;
      pending = schedule(() => {
        pending = null;
        run();
      }, options.minIntervalMs - elapsed);
    },
  };
}

async function saveCheckpointSafely(
  host: InnerLoopHost,
  input: Omit<RunCheckpoint, "workspaceDiffArtifact" | "workspaceDiffFingerprint" | "workspaceCaptureAvailable" | "workspaceCaptureError" | "repositoryHead" | "repositoryTree" | "changedFileHashes" | "savedAt">
): Promise<boolean> {
  if (!host.checkpointStore) return false;
  try {
    await host.checkpointStore.save(input);
    return true;
  } catch (error) {
    host.emit("checkpoint_failed", error instanceof Error ? error.message : String(error));
    return false;
  }
}

/**
 * Inner maxIterations loop: compact → prompt → chat → tools → verify.
 * Mutates host.messages / counters / turnCount in place.
 */
export type InnerLoopOutcome =
  | { status: "succeeded"; text: string }
  | { status: "paused"; text: string }
  | { status: "exhausted"; text: string; iterations: number };

export async function runInnerIterationLoop(host: InnerLoopHost): Promise<InnerLoopOutcome> {
  const toolSignatureCounts = new Map<string, number>();
  const efficiency = new RunEfficiencyGuard({ initialState: host.initialProgressState });
  let autoCompactSuppressed = false;
  let compactionBudgetNotified = false;
  const checkpointStateDir = host.checkpointStateDir ?? host.fileStateDir;
  const checkpointScheduler = host.checkpointSession && canWriteMidTurnCheckpoint(checkpointStateDir)
    ? createThrottledSessionCheckpoint({
        minIntervalMs: resolveCheckpointMinIntervalMs(),
        save: () => host.checkpointSession!(),
      })
    : null;
  if (host.checkpointSession && !checkpointScheduler) noteMidTurnCheckpointSkipped(checkpointStateDir);

  for (let i = 0; i < host.maxIterations; i++) {
    host.turnCount++;
    const runId = host.activeRunId ?? `run_untracked_${host.turnCount}`;
    const attemptId = `attempt_${runId}_${host.turnCount}`;
    host.executionEventBus.startAttempt({ runId, sessionId: host.sessionId, attemptId });

    const lastUserMsg = findLastUserMessageContent(host.messages);
    const sideEffectLedger = efficiency.formatSideEffectLedger();
    if (sideEffectLedger) {
      upsertSyntheticMessage(
        host.messages,
        "run_side_effects",
        sideEffectLedger,
        "run-side-effects-v1"
      );
    }

    // 默认自动压缩：上下文估计超阈值时摘要旧消息并保留最近轮
    {
      const { resolveAutoCompactConfig } = await import("../session/compact-auto.js");
      const autoCfg = resolveAutoCompactConfig();
      const needsCompaction =
        !autoCompactSuppressed &&
        autoCfg.enabled &&
        host.compactor.needsCompaction(host.messages);
      if (needsCompaction && efficiency.canCompact(host.turnCount)) {
        const beforeCount = host.messages.length;
        efficiency.recordCompaction(host.turnCount);
        console.error("\n📦 上下文压缩中...（" + beforeCount + " 条消息）");
        const compacted = await host.compactor.compactDetailed(
          host.messages,
          autoCfg.recentKeep
        );
        if (compacted.status === "failed") {
          autoCompactSuppressed = true;
          console.error("📦 压缩失败，保留原上下文并抑制本轮重试: " + compacted.reason);
          host.executionEventBus.emit({
            runId,
            sessionId: host.sessionId,
            attemptId,
            type: "compaction_failed",
            status: "failed",
            stage: "compaction",
            recoveryAction: "preserve_context",
          });
          host.emit("compaction_failed", { reason: compacted.reason, auto: true });
        } else if (compacted.status === "compacted") {
          host.messages.splice(0, host.messages.length, ...compacted.messages);
          host.compactionCount++;
          const afterCount = host.messages.length;
          console.error("📦 压缩完成 → " + afterCount + " 条消息\n");
          host.emit("context_compacted", {
            beforeCount,
            afterCount,
            auto: true,
          });
        }
      } else if (needsCompaction && !compactionBudgetNotified) {
        compactionBudgetNotified = true;
        console.error("📦 已达到自动压缩预算或冷却期，保留当前上下文。");
        host.emit("compaction_suppressed", {
          reason: "run_budget_or_cooldown",
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

    // 发送前历史修复：确保 assistant.tool_calls 与 tool 结果严格配对，避免
    // provider "tool_use_id 不匹配" 的整轮 400。
    {
      const repair = repairHistory(host.messages);
      if (repair.report.changed) {
        host.messages.splice(0, host.messages.length, ...repair.messages);
        host.emit("history_repair", repair.report);
      }
    }

    if (process.env.QLING_FEATURES_WORKFLOW_RUNTIME === "true") {
      await host.workflowRuntime.updateContext(host.messages);
    }

    const costBudget = resolveCostBudgetSignal({
      promptTokens: host.counters.sessionPromptTokens,
      completionTokens: host.counters.sessionCompletionTokens,
    });
    if (costBudget.exhausted) {
      const text =
        `费用预算暂停：本轮估算模型费用 ¥${costBudget.estimatedCostCny.toFixed(3)}` +
        `，已达到继续执行阈值 ¥${costBudget.maxCostCny?.toFixed(2)}。` +
        "当前会话未追加新的模型调用；提高预算后可用 /recover retry 继续。";
      host.recoveryController.pauseActiveRun();
      host.emit("cost_budget_exhausted", {
        estimatedCostCny: costBudget.estimatedCostCny,
        maxCostCny: costBudget.maxCostCny,
      });
      host.executionEventBus.completeAttempt(runId, "recovering");
      return { status: "paused", text };
    }

    const response = await host.chat(systemPrompt);
    const { content, tool_calls, usage } = response;
    host.counters = applyProviderUsage(host.counters, usage, host.usageLedger);
    host.messages.push({ role: "assistant", content, tool_calls });
    // 有工具调用时：中间推理/说明走 thinking（Markdown 渲染）；无工具时只由 appendFinal 展示，避免双份
    if (!response.streamed && tool_calls && tool_calls.length > 0 && content?.trim()) {
      host.emit("thinking", content);
    }

    if (!tool_calls || tool_calls.length === 0) {
      const progressState = efficiency.getProgressState();
      if ((progressState.pendingSideEffectIds?.length ?? 0) > 0) {
        upsertSyntheticMessage(
          host.messages,
          "efficiency_recovery",
          `<efficiency_recovery>后台任务 ${progressState.pendingSideEffectIds!.join(", ")} 尚未确认完成。运行中的任务请调用 bg_wait/bg_kill；恢复后为 unknown_outcome 的任务必须由用户明确批准 bg_reconcile，随后检查副作用并完成确定性验证。</efficiency_recovery>`,
          "background-side-effect-required-v3"
        );
        host.executionEventBus.completeAttempt(runId, "recovering");
        continue;
      }
      const deliverableMutationPaths = (progressState.activeMutationPaths ?? [])
        .filter((mutationPath) => mutationPath && !mutationPath.startsWith("<"));
      if (host.requireWorkspaceMutation && (!progressState.activeMutationId || deliverableMutationPaths.length === 0)) {
        upsertSyntheticMessage(
          host.messages,
          "efficiency_recovery",
          "<efficiency_recovery>当前编码任务尚未产生工作区交付变更。诊断脚本和 state artifact 不属于成果；必须直接修改目标源码或配置文件，再运行确定性验证。优先使用 read_anchored → patch_anchored，不能以分析总结代替补丁。</efficiency_recovery>",
          "workspace-mutation-required-v1",
        );
        host.executionEventBus.completeAttempt(runId, "recovering");
        continue;
      }
      if (progressState.activeMutationId && progressState.latestVerificationVerdict !== "pass") {
        if (!(host.deterministicVerificationAvailable ?? Boolean(host.verificationCommand))) {
          const text = `验证环境未就绪：修改 ${progressState.activeMutationId} 尚无可用的确定性验证器。请配置 /verify、补充项目测试命令或明确调整交付契约后恢复。`;
          host.recoveryController.pauseActiveRun();
          host.executionEventBus.completeAttempt(runId, "recovering");
          return { status: "paused", text };
        }
        upsertSyntheticMessage(
          host.messages,
          "efficiency_recovery",
          `<efficiency_recovery>修改 ${progressState.activeMutationId} 尚无通过的确定性验证。请调用 verify，或修正当前验证失败；不能直接宣告完成。</efficiency_recovery>`,
          "verification-required-v3"
        );
        host.executionEventBus.completeAttempt(runId, "recovering");
        continue;
      }
      const durableBackgroundTasks = (await import("../runtime/background-tasks.js"))
        .getBackgroundTaskRegistry(host.fileStateDir)
        .listUnsettledOwned({
          workspaceDir: host.workspaceDir,
          sessionId: host.sessionId,
          leaseToken: host.sessionLeaseToken,
        });
      if (durableBackgroundTasks.length > 0) {
        const taskIds = durableBackgroundTasks.map((task) => task.taskId);
        host.recoveryController.pauseActiveRun();
        host.executionEventBus.completeAttempt(runId, "recovering");
        return {
          status: "paused",
          text: `后台副作用尚未完成耐久结算：${taskIds.join(", ")}。请先等待、终止或确认 unknown_outcome 后再恢复。`,
        };
      }
      if (host.sessionLeaseToken) {
        assertSessionLeaseToken(host.fileStateDir, host.sessionId, host.sessionLeaseToken);
      }
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
      return { status: "succeeded", text: content };
    }

    console.error("\n🔧 执行 " + tool_calls.length + " 个工具...\n");
    const preparedCalls = prepareToolCalls(tool_calls as RawToolCall[], {
      parseRetries: host.parseRetries,
      toolRepeatLimit: host.toolRepeatLimit,
      signatureCounts: toolSignatureCounts,
    });
    const activeBeforeTools = efficiency.getProgressState().activeMutationId;
    if (activeBeforeTools) {
      for (const prepared of preparedCalls) {
        if (prepared.call.name !== "verify" || prepared.immediateResult) continue;
        const commandId = String(prepared.call.arguments.commandId ?? "");
        prepared.call.arguments = {
          ...prepared.call.arguments,
          verifierId: commandId,
          mutationId: activeBeforeTools,
          scope: efficiency.getActiveMutationPaths(),
        };
      }
    }
    for (const prepared of preparedCalls) {
      const actionFingerprint = fingerprintToolAction(prepared.call);
      if (!prepared.immediateResult && efficiency.isActionBlocked(actionFingerprint)) {
        prepared.immediateResult = {
          tool_call_id: prepared.call.id,
          output: `Error: [EFFICIENCY_ACTION_BLOCKED] ${prepared.call.name} 的相同参数已连续失败；必须修改参数或策略。`,
          is_error: true,
          error: {
            code: "EFFICIENCY_ACTION_BLOCKED",
            message: "action fingerprint is blocked after repeated failures",
            category: "guard",
          },
        };
      }
    }
    const loop = preparedCalls.find((prepared) => prepared.loopDetected);
    if (loop?.loopDetected) {
      host.executionEventBus.emit({
        runId,
        sessionId: host.sessionId,
        attemptId,
        toolCallId: loop.call.id,
        tool: loop.call.name,
        type: "loop_detected",
        status: "recovering",
        stage: "tool",
        category: "repeated_action",
        fingerprint: loop.loopDetected.signature,
        recoveryAction: "change_strategy",
      });
      host.emit("loop_detected", {
        tool: loop.call.name,
        count: loop.loopDetected.count,
        limit: loop.loopDetected.limit,
        signature: loop.loopDetected.signature,
      });
    }
    const { turnToolCalls, turnToolFailures, observations } = await executePreparedTools(
      {
        pipeline: host.pipeline,
        tools: host.tools,
        guardConfig: host.guardConfig,
        channel: host.channel,
        approvalGate: host.approvalGate,
        knowledgeAdapter: host.knowledgeAdapter,
        memoryStore: host.memoryStore,
        workspaceDir: host.workspaceDir,
        fileStateDir: host.fileStateDir,
        ownedPaths: host.ownedPaths,
        workflowRuntime: host.workflowRuntime,
        executionEventBus: host.executionEventBus,
        emit: host.emit,
        reflectiveThink: host.reflectiveThink,
        usageLedger: host.usageLedger,
        dispatchTool: host.dispatchTool,
        recordRuntimeTool: host.recordRuntimeTool,
      },
      {
        preparedCalls,
        messages: host.messages,
        runId,
        attemptId,
        sessionId: host.sessionId,
        sessionLeaseToken: host.sessionLeaseToken,
      }
    );
    checkpointScheduler?.afterToolBatch();
    const failureSignal = efficiency.recordTools(observations);
    const progressSignal = efficiency.recordObservationProgress(observations);
    const efficiencyStop = failureSignal ?? progressSignal;
    if (efficiencyStop?.disposition === "redirect") {
      const recoveryInstruction = (() => {
        switch (efficiencyStop.directive.action) {
          case "correct_parameters":
            return efficiencyStop.directive.suggestedTools?.length
              ? `结构化编辑参数无效；不要创建或执行临时修复脚本。先用 ${efficiencyStop.directive.suggestedTools.join(" → ")} 直接修改交付文件；原工具仍可在修正参数后使用。`
              : `参数指纹 ${efficiencyStop.directive.blockedFingerprint} 已暂时禁止；先读取错误并修改参数，不得原样重试。`;
          case "replan_repository":
            return `停止随机浏览；用 repo_map/repo_query/impact_analysis 重新定位根因，并保留已有变更与验证证据。${efficiencyStop.directive.rootCauseId ? ` 查询当前根因时传入 root_cause_id=${efficiencyStop.directive.rootCauseId}。` : ""}`;
          case "narrow_recovery":
            return `当前仅使用窄恢复工具集：${efficiencyStop.directive.allowedTools.join(", ")}。先检查环境、工作树和最近修改。`;
          case "verify_or_finish":
            return `修改 ${efficiencyStop.directive.mutationId} 已进入验证阶段；先重新对照原始用户任务，检查同一输入语义的所有解析/转换分支和哨兵值，再运行确定性验证。诊断辅助文件不属于交付成果，结束前应删除；只修正当前失败或完成必要交付检查。`;
          case "checkpoint":
            return `生成可恢复检查点：${efficiencyStop.directive.reason}`;
        }
      })();
      upsertSyntheticMessage(
        host.messages,
        "efficiency_recovery",
        `<efficiency_recovery>\n${efficiencyStop.reason}\n${recoveryInstruction}\n效率守卫只改变策略，不终止任务。\n</efficiency_recovery>`,
        "efficiency-recovery-v3"
      );
      host.executionEventBus.emit({
        runId,
        sessionId: host.sessionId,
        attemptId,
        tool: efficiencyStop.tool,
        type: "efficiency_guard",
        status: "recovering",
        stage: "tool",
        category: "repeated_action",
        fingerprint: efficiencyStop.fingerprint,
        recoveryAction: efficiencyStop.directive.action,
      });
      host.emit("efficiency_guard", efficiencyStop);
    }
    {
      const state = efficiency.getProgressState();
      const reconciledTaskIds = state.reconciledSideEffectIds ?? [];
      const completedTaskIds = observations
        .map((observation) => observation.backgroundTaskCompleted)
        .filter((taskId): taskId is string => Boolean(taskId));
      const checkpointSaved = host.checkpointStore && host.usageLedger
        ? await saveCheckpointSafely(host, {
        sequence: host.turnCount,
        phase: state.phase,
        progressState: state,
        ...(state.recoveryEpisode ? { recoveryEpisode: state.recoveryEpisode } : {}),
        usage: host.usageLedger.snapshot(),
        toolMetrics: {
          calls: host.toolCallTotal + turnToolCalls,
          failures: host.toolFailureTotal + turnToolFailures,
          policyRedirects: observations.filter((item) => item.redirected).length,
        },
      })
        : false;
      const failedReconciliations: string[] = [];
      const failedAccounting: string[] = [];
      const finalizedReconciliations: string[] = [];
      if (checkpointSaved && (reconciledTaskIds.length > 0 || completedTaskIds.length > 0)) {
        // A later run in the same session may be accounting for a task left by
        // a canceled run. Completion is session-scoped; cancellation itself is
        // still performed with an exact run owner in AgentLoop.
        const owner = { workspaceDir: host.workspaceDir, sessionId: host.sessionId, leaseToken: host.sessionLeaseToken };
        const registry = (await import("../runtime/background-tasks.js")).getBackgroundTaskRegistry(host.fileStateDir);
        for (const taskId of completedTaskIds) {
          try { registry.markAccountingSettled(taskId, owner); }
          catch (error) {
            failedAccounting.push(taskId);
            host.emit("background_accounting_finalize_failed", taskId, error instanceof Error ? error.message : String(error));
          }
        }
        for (const taskId of reconciledTaskIds) {
          try {
            registry.completeUnknownOutcomeReconciliation(taskId, owner);
            finalizedReconciliations.push(taskId);
          }
          catch (error) {
            failedReconciliations.push(taskId);
            host.emit("background_reconciliation_finalize_failed", taskId, error instanceof Error ? error.message : String(error));
          }
        }
      }
      if (finalizedReconciliations.length > 0) {
        efficiency.recordTools(finalizedReconciliations.map((taskId) => ({
          tool: "bg_reconcile",
          failed: false,
          actionFingerprint: `bg_reconcile:finalized:${taskId}`,
          backgroundTaskReconciliationFinalized: taskId,
        })));
      }
      if (reconciledTaskIds.length > 0 && (!checkpointSaved || failedReconciliations.length > 0)) {
        const blockedIds = checkpointSaved ? failedReconciliations : reconciledTaskIds;
        efficiency.recordTools(blockedIds.map((taskId) => ({
          tool: "bg_reconcile",
          failed: false,
          actionFingerprint: `bg_reconcile:persist:${taskId}`,
          backgroundTaskStarted: taskId,
        })));
      }
      if (completedTaskIds.length > 0 && (!checkpointSaved || failedAccounting.length > 0)) {
        const blockedIds = checkpointSaved ? failedAccounting : completedTaskIds;
        efficiency.recordTools(blockedIds.map((taskId) => ({
          tool: "bg_wait",
          failed: false,
          actionFingerprint: `background_accounting:persist:${taskId}`,
          backgroundTaskStarted: taskId,
        })));
      }
    }
    const verifyOutcome = await runWriteToolVerification(preparedCalls, {
      verificationCommand: host.verificationCommand,
      projectProfile: host.projectProfile,
      workspaceDir: host.workspaceDir,
      observations,
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
      return { status: "paused", text: verifyOutcome.text };
    }
    if (verifyOutcome.kind === "audit") {
      upsertSyntheticMessage(
        host.messages,
        "verification_audit",
        `<verification_audit>\n${verifyOutcome.text}\n</verification_audit>`,
        "post-mutation-audit-v1",
      );
    }
    if (verifyOutcome.kind === "recover") {
      efficiency.recordTools([{
        tool: "verify",
        failed: true,
        progressKind: "verification_delta",
        evidenceFingerprint: `verification:failed:${verifyOutcome.failureMessage}`,
        verificationVerdict: "fail",
        failureFingerprint: verifyOutcome.failureMessage,
      }]);
      host.messages.push({ role: "user", content: verifyOutcome.userMessage });
      host.emit(
        "repair",
        verifyOutcome.failureMessage,
        verifyOutcome.strategy,
        verifyOutcome.strategyAttempts
      );
      host.executionEventBus.completeAttempt(runId, "recovering");
      if (host.checkpointStore && host.usageLedger) {
        const state = efficiency.getProgressState();
        await saveCheckpointSafely(host, { sequence: host.turnCount, phase: state.phase, progressState: state, ...(state.recoveryEpisode ? { recoveryEpisode: state.recoveryEpisode } : {}), usage: host.usageLedger.snapshot(), toolMetrics: { calls: host.toolCallTotal + turnToolCalls, failures: host.toolFailureTotal + turnToolFailures, policyRedirects: observations.filter((item) => item.redirected).length }, latestVerification: { verdict: "fail", fingerprint: verifyOutcome.failureMessage } });
      }
      continue;
    }
    if (verifyOutcome.kind === "pass") {
      const auditIndex = host.messages.findIndex(
        (message) => message.synthetic_reason === "verification_audit",
      );
      if (auditIndex >= 0) host.messages.splice(auditIndex, 1);
      const activeMutationId = efficiency.getProgressState().activeMutationId;
      const finishSignal = efficiency.recordObservationProgress([{
        tool: "verify",
        failed: false,
        progressKind: "verification_delta",
        evidenceFingerprint: `verification:passed:${verifyOutcome.summary}`,
        verificationVerdict: "pass",
        mutationId: activeMutationId,
        verifierId: "runtime:auto",
        verificationBaseFingerprint: verifyOutcome.verificationBaseFingerprint,
        workspaceFingerprint: verifyOutcome.workspaceFingerprint,
      }]);
      if (finishSignal?.directive.action === "verify_or_finish") {
        upsertSyntheticMessage(
          host.messages,
          "efficiency_recovery",
          `<efficiency_recovery>\n${finishSignal.reason}\n修改 ${finishSignal.directive.mutationId} 已通过验证；完成必要交付检查或结束任务。\n</efficiency_recovery>`,
          "efficiency-recovery-v3"
        );
      }
      if (host.checkpointStore && host.usageLedger) {
        const state = efficiency.getProgressState();
        await saveCheckpointSafely(host, { sequence: host.turnCount, phase: state.phase, progressState: state, usage: host.usageLedger.snapshot(), toolMetrics: { calls: host.toolCallTotal + turnToolCalls, failures: host.toolFailureTotal + turnToolFailures, policyRedirects: observations.filter((item) => item.redirected).length }, latestVerification: { verdict: "pass", fingerprint: verifyOutcome.summary } });
      }
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

  return {
    status: "exhausted",
    text: "⚠️ 达到最大迭代次数，任务未完成。",
    iterations: host.maxIterations,
  };
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
  executeInner: () => Promise<InnerLoopOutcome>;
  isCanceled?: () => boolean;
  providerRetryLimit?: number;
  sleep?: (delayMs: number) => Promise<void>;
  onProviderRetry?: () => void;
  setActiveRun: (
    run: { runId: string; sessionId: string; originalTask: string; startedAt: number } | null
  ) => void;
}

/**
 * Outer loop: start run, handle provider transport retries + recovery strategy.
 */
export async function runOuterAgentLoop(host: OuterLoopHost): Promise<RunOutcome> {
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
  }
  // Idempotent in-process, and re-establishes event-bus ownership after daemon restart.
  host.executionEventBus.startRun({ runId, sessionId: host.sessionId });

  let transportAttempts = 0;
  while (true) {
    try {
      const response = await host.executeInner();
      if (response.status === "paused") {
        return { status: "paused", runId, text: response.text, recovery: host.getRecoveryState() };
      }
      if (host.getRecoveryState()?.status === "paused") {
        host.executionEventBus.completeAttempt(runId, "recovering");
        return {
          status: "paused",
          runId,
          text: host.formatRecoveryPause("run paused by operator", "使用 /recover retry 继续"),
          recovery: host.getRecoveryState(),
        };
      }
      if (host.isCanceled?.()) {
        host.executionEventBus.completeAttempt(runId, "canceled");
        host.executionEventBus.completeRun(runId, "canceled");
        host.recoveryController.completeRun("canceled");
        host.setActiveRun(null);
        return { status: "canceled", runId, text: "Agent run canceled", reason: "user_canceled" };
      }
      if (response.status === "exhausted") {
        host.executionEventBus.completeAttempt(runId, "exhausted");
        host.executionEventBus.completeRun(runId, "exhausted");
        host.recoveryController.completeRun("exhausted");
        host.setActiveRun(null);
        return { ...response, runId };
      }
      host.executionEventBus.completeRun(runId, "succeeded");
      host.recoveryController.completeRun("succeeded");
      host.setActiveRun(null);
      return { status: "succeeded", runId, text: response.text };
    } catch (error) {
      if (host.getRecoveryState()?.status === "paused") {
        host.executionEventBus.completeAttempt(runId, "recovering");
        return {
          status: "paused",
          runId,
          text: host.formatRecoveryPause("run paused by operator", "使用 /recover retry 继续"),
          recovery: host.getRecoveryState(),
        };
      }
      if (host.isCanceled?.()) {
        host.executionEventBus.completeAttempt(runId, "canceled");
        host.executionEventBus.completeRun(runId, "canceled");
        host.recoveryController.completeRun("canceled");
        host.setActiveRun(null);
        return { status: "canceled", runId, text: "Agent run canceled", reason: "user_canceled" };
      }
      host.executionEventBus.completeAttempt(runId, "failed");
      const failure = classifyFailure(error, { provider: true });
      const providerRetryLimit = Math.max(0, host.providerRetryLimit ?? 3);
      if (failure.category === "provider_transient" && transportAttempts < providerRetryLimit) {
        transportAttempts++;
        host.onProviderRetry?.();
        const retryAfter = typeof error === "object" && error !== null && "retryAfterMs" in error
          ? Number((error as { retryAfterMs?: unknown }).retryAfterMs)
          : 0;
        const delay = Math.max(
          Number.isFinite(retryAfter) ? retryAfter : 0,
          Math.min(4_000, 250 * 2 ** (transportAttempts - 1)) + Math.floor(Math.random() * 100)
        );
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
        await (host.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(delay);
        continue;
      }
      if (failure.category === "provider_transient") {
        host.executionEventBus.completeRun(runId, "failed");
        host.recoveryController.completeRun("failed");
        host.setActiveRun(null);
        return { status: "failed", runId, text: failure.message, failure };
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
        return {
          status: "paused",
          runId,
          text: host.formatRecoveryPause(failure.message, decision.reason),
          recovery: state,
        };
      }
      if (decision.action === "fail") {
        host.executionEventBus.completeRun(runId, "failed");
        host.recoveryController.completeRun("failed");
        host.setActiveRun(null);
        return { status: "failed", runId, text: failure.message, failure };
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
