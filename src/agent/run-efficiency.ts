import path from "node:path";

export type FileMutation = "created" | "updated";

export interface ToolExecutionObservation {
  tool: string;
  failed: boolean;
  /** The call was rejected by the efficiency policy before tool execution. */
  redirected?: boolean;
  actionFingerprint?: string;
  progressKind?: Exclude<ProgressSignal["kind"], "no_progress">;
  evidenceFingerprint?: string;
  rootCauseId?: string;
  mutationId?: string;
  verifierId?: string;
  verificationVerdict?: "pass" | "fail";
  workspaceFingerprint?: string;
  verificationBaseFingerprint?: string;
  failureFingerprint?: string;
  failureCode?: string;
  targetPath?: string;
  changedPaths?: string[];
  mutation?: FileMutation;
  backgroundTaskStarted?: string;
  backgroundTaskCompleted?: string;
  backgroundTaskReconciled?: string;
  backgroundTaskReconciliationFinalized?: string;
}

export interface EfficiencySignal {
  code: "SAME_FAILURE_LIMIT" | "TOTAL_FAILURE_LIMIT" | "PROGRESS_PHASE";
  disposition: "redirect";
  reason: string;
  phase?: ProgressPhase;
  tool?: string;
  fingerprint?: string;
  directive: RecoveryDirective;
}

export type ProgressPhase = "explore" | "diagnose" | "mutate" | "verify" | "repair" | "finalize";

export type RecoveryReason =
  | "repeated_action"
  | "no_new_evidence"
  | "verification_failed"
  | "environment_blocked"
  | "tool_unavailable"
  | "request_timeout";

export type ToolCapabilityId = string;
export type RecoveryExitCondition =
  | "new_root_cause_evidence"
  | "new_mutation"
  | "verification_changed"
  | "environment_changed"
  | "user_intervention";

export interface RecoveryEpisode {
  id: string;
  phase: ProgressPhase;
  reason: RecoveryReason;
  rootCauseId?: string;
  mutationId?: string;
  verifierId?: string;
  startedAtSequence: number;
  lastProgressSequence: number;
  preferredCapabilities: ToolCapabilityId[];
  blockedActionFingerprints: string[];
  exitConditions: RecoveryExitCondition[];
}

export interface ProgressState {
  sequence: number;
  phase: ProgressPhase;
  activeRootCauseId?: string;
  activeMutationId?: string;
  activeMutationPaths?: string[];
  activeMutationWorkspaceFingerprint?: string;
  latestVerificationVerdict?: "pass" | "fail" | "blocked";
  pendingSideEffectIds?: string[];
  reconciledSideEffectIds?: string[];
  recoveryEpisode?: RecoveryEpisode;
}

export type ProgressEvent =
  | { type: "start_recovery"; reason: RecoveryReason; preferredCapabilities: ToolCapabilityId[]; rootCauseId?: string }
  | { type: "mutation_succeeded"; mutationId: string }
  | { type: "verification_finished"; verifierId: string; verdict: "pass" | "fail" | "blocked"; fingerprint: string }
  | { type: "root_cause_changed"; rootCauseId: string }
  | { type: "finalize_requested" };

export function createInitialProgressState(): ProgressState {
  return { sequence: 0, phase: "explore" };
}

function makeEpisode(
  state: ProgressState,
  input: Omit<RecoveryEpisode, "id" | "startedAtSequence" | "lastProgressSequence" | "blockedActionFingerprints">
): RecoveryEpisode {
  const sequence = state.sequence + 1;
  if (input.exitConditions.length === 0) throw new Error("RecoveryEpisode requires an exit condition");
  return {
    ...input,
    id: `recovery-${sequence}`,
    startedAtSequence: sequence,
    lastProgressSequence: sequence,
    blockedActionFingerprints: [],
  };
}

/** Pure transition function. Execution code may report events but must not mutate this state. */
export function reduceProgressState(state: ProgressState, event: ProgressEvent): ProgressState {
  const sequence = state.sequence + 1;
  switch (event.type) {
    case "start_recovery":
      return {
        ...state,
        sequence,
        phase: state.activeMutationId ? "repair" : "diagnose",
        activeRootCauseId: event.rootCauseId ?? state.activeRootCauseId,
        recoveryEpisode: makeEpisode(state, {
          phase: state.activeMutationId ? "repair" : "diagnose",
          reason: event.reason,
          rootCauseId: event.rootCauseId ?? state.activeRootCauseId,
          mutationId: state.activeMutationId,
          preferredCapabilities: event.preferredCapabilities,
          exitConditions: state.activeMutationId
            ? ["new_mutation", "verification_changed", "user_intervention"]
            : ["new_root_cause_evidence", "environment_changed", "user_intervention"],
        }),
      };
    case "mutation_succeeded":
      return {
        ...state,
        sequence,
        phase: "verify",
        activeMutationId: event.mutationId,
        latestVerificationVerdict: undefined,
        recoveryEpisode: makeEpisode(state, {
          phase: "verify",
          reason: "no_new_evidence",
          rootCauseId: state.activeRootCauseId,
          mutationId: event.mutationId,
          preferredCapabilities: ["read", "patch", "write", "verify", "bash"],
          exitConditions: ["verification_changed", "new_mutation", "user_intervention"],
        }),
      };
    case "verification_finished": {
      const passed = event.verdict === "pass";
      return {
        ...state,
        sequence,
        phase: passed ? "finalize" : "repair",
        latestVerificationVerdict: event.verdict,
        recoveryEpisode: passed ? undefined : makeEpisode(state, {
          phase: "repair",
          reason: "verification_failed",
          rootCauseId: state.activeRootCauseId,
          mutationId: state.activeMutationId,
          verifierId: event.verifierId,
          preferredCapabilities: ["read", "repo_query", "impact_analysis", "patch", "write", "verify", "bash"],
          exitConditions: ["new_mutation", "verification_changed", "user_intervention"],
        }),
      };
    }
    case "root_cause_changed":
      return {
        ...state,
        sequence,
        phase: state.activeMutationId ? "repair" : "diagnose",
        activeRootCauseId: event.rootCauseId,
        recoveryEpisode: state.activeMutationId
          ? makeEpisode(state, {
              phase: "repair",
              reason: "verification_failed",
              rootCauseId: event.rootCauseId,
              mutationId: state.activeMutationId,
              preferredCapabilities: ["read", "repo_query", "impact_analysis", "patch", "write", "verify", "bash"],
              exitConditions: ["new_mutation", "verification_changed", "user_intervention"],
            })
          : undefined,
      };
    case "finalize_requested":
      return state.latestVerificationVerdict === "fail"
        ? { ...state, sequence }
        : { ...state, sequence, phase: "finalize", recoveryEpisode: undefined };
  }
}

export interface ProgressSignal {
  phase: ProgressPhase;
  sourceTool?: string;
  kind:
    | "causal_repository_evidence"
    | "successful_mutation"
    | "verification_delta"
    | "environment_delta"
    | "no_progress";
  fingerprint: string;
  rootCauseId?: string;
  mutationId?: string;
  verifierId?: string;
  value: number;
}

export type RecoveryDirective =
  | { action: "correct_parameters"; blockedFingerprint: string; suggestedTools?: string[] }
  | { action: "replan_repository"; rootCauseId?: string; preserveEvidence?: string[] }
  | { action: "narrow_recovery"; allowedTools: string[] }
  | { action: "verify_or_finish"; mutationId: string }
  | { action: "checkpoint"; reason: string };

export interface RunEfficiencyOptions {
  sameFailureLimit?: number;
  totalFailureLimit?: number;
  maxCompactions?: number;
  compactionCooldownTurns?: number;
  noProgressReplanLimit?: number;
  noProgressNarrowLimit?: number;
  initialState?: ProgressState;
}

export function classifyToolProgressKind(
  tool: string,
  args: Record<string, unknown> = {}
): Exclude<ProgressSignal["kind"], "no_progress"> | undefined {
  if (["repo_map", "repo_query", "impact_analysis", "code_symbols", "lsp"].includes(tool)) {
    return "causal_repository_evidence";
  }
  if (tool === "verify") return "verification_delta";
  if (tool !== "bash") return undefined;

  const command = String(args.command ?? args.cmd ?? "").trim().toLowerCase();
  if (!command) return undefined;
  if (/(?:^|[;&|\s])(?:pytest|py\.test|npm\s+(?:run\s+)?test|pnpm\s+(?:run\s+)?test|yarn\s+test|cargo\s+test|go\s+test|mvn(?:w)?\s+test|gradle(?:w)?\s+test|tsc|eslint|ruff|mypy)(?:\s|$)/i.test(command)) {
    return "verification_delta";
  }
  if (/(?:^|[;&|\s])(?:where|which)(?:\s|$)|(?:node|python|python3|npm|pnpm|yarn|cargo|go|java)\s+--?version(?:\s|$)/i.test(command)) {
    return "environment_delta";
  }
  return undefined;
}

export function normalizeEvidenceOutput(value: string): string {
  return value
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\b\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}(?:\.\d+)?z\b/gi, "<timestamp>")
    .replace(/\bduration_ms\s*:\s*\d+(?:\.\d+)?\b/gi, "duration_ms: <duration>")
    .replace(/\b\d+(?:\.\d+)?\s*(?:ms|milliseconds?|seconds?|secs?|s)\b/gi, "<duration>")
    .replace(/[a-z]:[\\/](?:users[\\/][^\\/\s]+[\\/])?appdata[\\/]local[\\/]temp[\\/][^\s]*/gi, "<temp-path>")
    .replace(/\/tmp\/[^\s]*/g, "<temp-path>")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function isSingleNarrowBashCommand(args: Record<string, unknown>): boolean {
  const rawCommand = String(args.command ?? args.cmd ?? "").trim();
  const command = rawCommand.replace(
    /\s+(?:2>&1\s*)?\|\s*(?:tail|head)\s+(?:-n\s+|-)?\d+\s*$/i,
    ""
  );
  if (!command || /[\r\n;&|<>`]|\$\(/.test(command)) return false;
  if (/(?:^|\s)(?:--fix(?:-dry-run)?|--write|--output(?:-file)?(?:=|\s)|--junitxml(?:=|\s)|-o(?:\s|$))/i.test(command)) {
    return false;
  }
  if (/^tsc(?:\s|$)/i.test(command) && !/(?:^|\s)--noemit(?:\s|$)/i.test(command)) {
    return false;
  }
  return /^(?:(?:python|python3)\s+-m\s+)?(?:pytest|py\.test)(?:\s|$)|^(?:npm|pnpm)\s+(?:run\s+)?test(?:\s|$)|^yarn\s+test(?:\s|$)|^(?:cargo|go)\s+test(?:\s|$)|^mvnw?\s+test(?:\s|$)|^gradlew?\s+test(?:\s|$)|^(?:tsc|eslint|ruff|mypy)(?:\s|$)|^git\s+(?:diff|status|grep|show|log)(?:\s|$)|^(?:rg|grep|findstr|select-string|get-content|where|which)(?:\s|$)|^(?:node|python|python3|npm|pnpm|yarn|cargo|go|java)\s+--?version(?:\s|$)/i.test(command);
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\r?\n/g, " ")
    .replace(/[a-z]:[\\/](?:[^<>:"|?*\r\n]+[\\/])*[^<>:"|?*\r\n]*/gi, "<path>")
    .replace(/(?:\/[^/\s:]+){2,}/g, "<path>")
    .replace(/\b\d+(?:\.\d+)?\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320);
}

export function normalizeFailureFingerprint(input: {
  tool: string;
  code?: string;
  category?: string;
  message?: string;
}): string {
  return [
    normalizeText(input.tool) || "unknown",
    normalizeText(input.category) || "runtime",
    normalizeText(input.code) || "tool_error",
    normalizeText(input.message) || "unknown_failure",
  ].join(":");
}

export class RunEfficiencyGuard {
  private readonly sameFailureLimit: number;
  private readonly totalFailureLimit: number;
  private readonly maxCompactions: number;
  private readonly compactionCooldownTurns: number;
  private readonly noProgressReplanLimit: number;
  private readonly noProgressNarrowLimit: number;
  private lastFailureKey: string | null = null;
  private consecutiveFailureCount = 0;
  private readonly sideEffects = new Map<string, "created" | "updated" | "created_then_updated">();
  private readonly mutationPaths = new Map<string, string[]>();
  private totalFailures = 0;
  private consecutiveEditFailures = 0;
  private compactions = 0;
  private lastCompactionTurn: number | null = null;
  private noProgressActions = 0;
  private readonly evidenceFingerprints = new Set<string>();
  private readonly blockedActionFingerprints = new Set<string>();
  private recoveryAllowedTools: Set<string> | null = null;
  private progressState: ProgressState = createInitialProgressState();
  private phase: ProgressPhase = "explore";
  private activeRootCauseId: string | null = null;
  private activeMutationId: string | null = null;
  private activeMutationWorkspaceFingerprint: string | null = null;
  private readonly pendingSideEffectIds = new Set<string>();
  private readonly reconciledSideEffectIds = new Set<string>();

  constructor(options: RunEfficiencyOptions = {}) {
    this.sameFailureLimit = Math.max(1, options.sameFailureLimit ?? 2);
    this.totalFailureLimit = Math.max(1, options.totalFailureLimit ?? 8);
    this.maxCompactions = Math.max(0, options.maxCompactions ?? 2);
    this.compactionCooldownTurns = Math.max(0, options.compactionCooldownTurns ?? 4);
    this.noProgressReplanLimit = Math.max(1, options.noProgressReplanLimit ?? 4);
    this.noProgressNarrowLimit = Math.max(this.noProgressReplanLimit + 1, options.noProgressNarrowLimit ?? 8);
    if (options.initialState) {
      this.progressState = structuredClone(options.initialState);
      this.phase = options.initialState.phase;
      this.activeRootCauseId = options.initialState.activeRootCauseId ?? null;
      this.activeMutationId = options.initialState.activeMutationId ?? null;
      this.activeMutationWorkspaceFingerprint = options.initialState.activeMutationWorkspaceFingerprint ?? null;
      if (this.activeMutationId) {
        this.mutationPaths.set(this.activeMutationId, [...(options.initialState.activeMutationPaths ?? [])]);
      }
      for (const taskId of options.initialState.pendingSideEffectIds ?? []) this.pendingSideEffectIds.add(taskId);
      for (const taskId of options.initialState.reconciledSideEffectIds ?? []) this.reconciledSideEffectIds.add(taskId);
    }
  }

  recordTools(observations: readonly ToolExecutionObservation[]): EfficiencySignal | null {
    let pendingSignal: EfficiencySignal | null = null;
    for (const observation of observations) {
      // A policy redirect is feedback to the model, not another execution
      // failure. Feeding it back into the guard would recursively escalate the
      // very recovery scope that produced it.
      if (observation.redirected) continue;
      if (observation.backgroundTaskStarted) this.pendingSideEffectIds.add(observation.backgroundTaskStarted);
      if (observation.backgroundTaskCompleted) this.pendingSideEffectIds.delete(observation.backgroundTaskCompleted);
      if (observation.backgroundTaskReconciled) {
        this.pendingSideEffectIds.delete(observation.backgroundTaskReconciled);
        this.reconciledSideEffectIds.add(observation.backgroundTaskReconciled);
      }
      if (observation.backgroundTaskReconciliationFinalized) this.reconciledSideEffectIds.delete(observation.backgroundTaskReconciliationFinalized);
      if (observation.mutation) {
        const targets = observation.changedPaths?.length
          ? observation.changedPaths
          : observation.targetPath ? [observation.targetPath] : [];
        for (const rawTarget of targets) {
          const target = path.normalize(rawTarget);
          const previous = this.sideEffects.get(target);
          const next =
            previous === "created" && observation.mutation === "updated"
              ? "created_then_updated"
              : previous ?? observation.mutation;
          this.sideEffects.set(target, next);
        }
        const observedMutationId = observation.mutationId
          ?? observation.actionFingerprint
          ?? `${observation.tool}:mutation`;
        const startsNewDeliverable = !this.activeMutationId
          || this.progressState.latestVerificationVerdict === "pass";
        const mutationId = startsNewDeliverable ? observedMutationId : this.activeMutationId!;
        const accumulatedTargets = startsNewDeliverable
          ? [...targets]
          : [...new Set([...(this.mutationPaths.get(mutationId) ?? []), ...targets])];
        this.activeMutationId = mutationId;
        this.activeMutationWorkspaceFingerprint = observation.workspaceFingerprint ?? null;
        this.mutationPaths.set(mutationId, accumulatedTargets);
        this.phase = "verify";
        this.progressState = {
          ...reduceProgressState(this.progressState, { type: "mutation_succeeded", mutationId }),
          activeMutationPaths: accumulatedTargets,
          activeMutationWorkspaceFingerprint: observation.workspaceFingerprint ?? undefined,
        };
        this.recoveryAllowedTools = new Set(["read", "patch", "write", "verify", "bash"]);
        this.recordProgress({ phase: "mutate", kind: "successful_mutation", fingerprint: mutationId, mutationId, value: 1 });
        pendingSignal ??= {
          code: "PROGRESS_PHASE",
          disposition: "redirect",
          phase: "verify",
          reason: "已产生有效工作区修改；先验证该修改，再继续探索或结束任务。",
          tool: observation.tool,
          fingerprint: mutationId,
          directive: { action: "verify_or_finish", mutationId },
        };
      }

      if (!observation.failed) {
        if (["patch", "patch_anchored", "write"].includes(observation.tool)) {
          this.consecutiveEditFailures = 0;
        }
        this.lastFailureKey = null;
        this.consecutiveFailureCount = 0;
        continue;
      }
      this.totalFailures++;
      const isRecoverableEditFailure = ["patch", "patch_anchored", "write"].includes(observation.tool)
        && /^(?:TOOL_INVALID_ARGUMENTS|TOOL_SPEC_VIOLATION|PATCH_INVALID_CHUNKS|PATCH_INVALID_CHUNK|PATCH_SEARCH_NOT_FOUND|PATCH_SEARCH_AMBIGUOUS|ANCHORED_INVALID_INPUT|ANCHORED_STALE_OR_AMBIGUOUS)$/i.test(observation.failureCode ?? "");
      const shouldSuggestAnchoredEditImmediately = observation.tool === "patch"
        && isRecoverableEditFailure;
      this.consecutiveEditFailures = isRecoverableEditFailure ? this.consecutiveEditFailures + 1 : 0;
      const fingerprint =
        observation.failureFingerprint ??
        normalizeFailureFingerprint({ tool: observation.tool, message: "unknown failure" });
      const failureKey = `${observation.actionFingerprint ?? observation.tool}:${fingerprint}`;
      this.activeRootCauseId = observation.rootCauseId ?? observation.failureFingerprint ?? failureKey;
      if (this.progressState.activeRootCauseId !== this.activeRootCauseId) {
        this.progressState = reduceProgressState(this.progressState, {
          type: "root_cause_changed",
          rootCauseId: this.activeRootCauseId,
        });
      }

      if (observation.progressKind === "verification_delta") {
        this.phase = "repair";
        this.progressState = reduceProgressState(this.progressState, {
          type: "verification_finished",
          verifierId: observation.verifierId ?? "verify",
          verdict: "fail",
          fingerprint,
        });
        const allowedTools = ["repo_query", "impact_analysis", "read", "patch", "write", "bash"];
        this.recoveryAllowedTools = new Set(allowedTools);
        if (observation.evidenceFingerprint) {
          this.evidenceFingerprints.add(observation.evidenceFingerprint);
        }
        pendingSignal ??= {
          code: "PROGRESS_PHASE",
          disposition: "redirect",
          phase: "repair",
          reason: "确定性验证失败；回到最近修改点，优先定位并修正当前失败。",
          tool: observation.tool,
          fingerprint,
          directive: { action: "narrow_recovery", allowedTools },
        };
      }
      if (failureKey === this.lastFailureKey) {
        this.consecutiveFailureCount++;
      } else {
        this.lastFailureKey = failureKey;
        this.consecutiveFailureCount = 1;
      }

      if (this.consecutiveFailureCount >= this.sameFailureLimit) {
        const count = this.consecutiveFailureCount;
        this.consecutiveFailureCount = 0;
        this.lastFailureKey = null;
        this.blockedActionFingerprints.add(observation.actionFingerprint ?? failureKey);
        pendingSignal ??= {
          code: "SAME_FAILURE_LIMIT",
          disposition: "redirect",
          reason: `相同动作连续失败 ${count} 次；禁止原样重试，请更换参数、工具或策略。`,
          tool: observation.tool,
          fingerprint,
          directive: { action: "correct_parameters", blockedFingerprint: failureKey },
        };
      } else if (shouldSuggestAnchoredEditImmediately || this.consecutiveEditFailures >= 2) {
        this.consecutiveEditFailures = 0;
        pendingSignal ??= {
          code: "SAME_FAILURE_LIMIT",
          disposition: "redirect",
          reason: "结构化编辑失败；建议先用 read_anchored 获取稳定行锚点，再用 patch_anchored 直接修改目标源码。不要创建或执行临时修复脚本代替实际交付。",
          tool: observation.tool,
          fingerprint,
          directive: {
            action: "correct_parameters",
            blockedFingerprint: failureKey,
            suggestedTools: ["read_anchored", "patch_anchored"],
          },
        };
      } else if (this.totalFailures >= this.totalFailureLimit) {
        this.totalFailures = 0;
        pendingSignal ??= {
          code: "TOTAL_FAILURE_LIMIT",
          disposition: "redirect",
          reason: `近期工具失败累计达到 ${this.totalFailureLimit} 次；请收敛探索范围、汇总证据并切换恢复策略。`,
          tool: observation.tool,
          fingerprint,
          directive: {
            action: "replan_repository",
            preserveEvidence: [...this.evidenceFingerprints].slice(-20),
          },
        };
      }
    }
    return pendingSignal;
  }

  recordProgress(signal: ProgressSignal): EfficiencySignal | null {
    if (signal.kind !== "no_progress" && signal.value > 0) {
      if (this.evidenceFingerprints.has(signal.fingerprint)) {
        return this.recordProgress({
          phase: this.phase,
          kind: "no_progress",
          fingerprint: signal.fingerprint,
          value: 0,
        });
      }
      this.evidenceFingerprints.add(signal.fingerprint);

      if (signal.kind === "successful_mutation") {
        this.noProgressActions = 0;
        return null;
      }

      const inRecovery = this.phase === "repair" || this.phase === "diagnose" || this.recoveryAllowedTools !== null;
      const matchesRootCause = Boolean(
        signal.kind === "causal_repository_evidence"
        && signal.rootCauseId
        && this.activeRootCauseId
        && signal.rootCauseId === this.activeRootCauseId
      );
      const resolvesExplorationRecovery = Boolean(
        signal.kind === "causal_repository_evidence"
        && ["repo_map", "repo_query", "impact_analysis", "code_symbols", "lsp"].includes(signal.sourceTool ?? "")
        && !this.activeRootCauseId
        && !this.activeMutationId
      );
      const canRelease = !inRecovery || matchesRootCause || resolvesExplorationRecovery;
      if (canRelease) {
        this.noProgressActions = 0;
        this.blockedActionFingerprints.clear();
        if (matchesRootCause || resolvesExplorationRecovery) {
          this.phase = "explore";
          this.recoveryAllowedTools = null;
          this.progressState = {
            ...this.progressState,
            sequence: this.progressState.sequence + 1,
            phase: "explore",
            activeRootCauseId: matchesRootCause ? undefined : this.progressState.activeRootCauseId,
            recoveryEpisode: undefined,
          };
          if (matchesRootCause) this.activeRootCauseId = null;
        }
      }
      return null;
    }
    this.noProgressActions++;
    if (this.noProgressActions === this.noProgressNarrowLimit) {
      const allowedTools = this.activeMutationId
        ? ["repo_query", "impact_analysis", "read", "patch", "write", "bash"]
        : ["repo_map", "repo_query", "impact_analysis", "read", "search", "bash"];
      this.recoveryAllowedTools = new Set(allowedTools);
      this.phase = this.activeMutationId ? "repair" : "diagnose";
      this.progressState = reduceProgressState(this.progressState, {
        type: "start_recovery",
        reason: "no_new_evidence",
        preferredCapabilities: allowedTools,
        rootCauseId: this.activeRootCauseId ?? undefined,
      });
      return {
        code: "TOTAL_FAILURE_LIMIT",
        disposition: "redirect",
        reason: this.activeMutationId
          ? `连续 ${this.noProgressActions} 个动作没有产生新证据；保留最近修改，只允许定位、修正并验证该修改。`
          : `连续 ${this.noProgressActions} 个动作没有产生新证据；保留现有成果并切换到环境、仓库索引和验证恢复工具。`,
        fingerprint: signal.fingerprint,
        phase: this.phase,
        directive: {
          action: "narrow_recovery",
          allowedTools,
        },
      };
    }
    if (this.noProgressActions === this.noProgressReplanLimit) {
      return {
        code: "TOTAL_FAILURE_LIMIT",
        disposition: "redirect",
        reason: `连续 ${this.noProgressActions} 个动作没有产生新证据；停止随机浏览，基于仓库索引、错误根因和验证差异重新规划。`,
        fingerprint: signal.fingerprint,
        phase: this.phase,
        directive: {
          action: "replan_repository",
          rootCauseId: this.activeRootCauseId ?? undefined,
          preserveEvidence: [...this.evidenceFingerprints].slice(-20),
        },
      };
    }
    return null;
  }

  recordObservationProgress(
    observations: readonly ToolExecutionObservation[]
  ): EfficiencySignal | null {
    const actionable = observations.filter((item) => !item.redirected);
    if (actionable.length === 0) return null;
    if (actionable.some((item) => !item.failed && item.mutation)) return null;
    const verification = actionable.find(
      (item) => !item.failed
        && item.tool === "verify"
        && item.progressKind === "verification_delta"
        && item.evidenceFingerprint
        && item.verificationVerdict === "pass"
        && item.mutationId === this.activeMutationId
        && Boolean(item.workspaceFingerprint)
        && Boolean(this.activeMutationWorkspaceFingerprint)
        && item.verificationBaseFingerprint === this.activeMutationWorkspaceFingerprint
    );
    if (verification?.evidenceFingerprint && this.activeMutationId) {
      this.evidenceFingerprints.add(verification.evidenceFingerprint);
      this.noProgressActions = 0;
      this.phase = "finalize";
      this.progressState = reduceProgressState(this.progressState, {
        type: "verification_finished",
        verifierId: verification.verifierId ?? "verify",
        verdict: "pass",
        fingerprint: verification.evidenceFingerprint,
      });
      this.recoveryAllowedTools = new Set(["read", "bash"]);
      return {
        code: "PROGRESS_PHASE",
        disposition: "redirect",
        phase: "finalize",
        reason: "最近修改已通过确定性验证；仅完成必要交付检查或结束任务。",
        tool: verification.tool,
        fingerprint: verification.evidenceFingerprint,
        directive: { action: "verify_or_finish", mutationId: this.activeMutationId },
      };
    }
    const staleVerification = actionable.find((item) => !item.failed
      && item.tool === "verify"
      && item.progressKind === "verification_delta"
      && item.verificationVerdict === "pass"
      && item.mutationId === this.activeMutationId
      && Boolean(item.verificationBaseFingerprint)
      && Boolean(this.activeMutationWorkspaceFingerprint)
      && item.verificationBaseFingerprint !== this.activeMutationWorkspaceFingerprint);
    if (staleVerification?.workspaceFingerprint && this.activeMutationId) {
      this.phase = "repair";
      this.activeMutationWorkspaceFingerprint = staleVerification.workspaceFingerprint;
      this.mutationPaths.set(this.activeMutationId, []);
      this.progressState = {
        ...this.progressState,
        sequence: this.progressState.sequence + 1,
        phase: "repair",
        activeMutationPaths: [],
        activeMutationWorkspaceFingerprint: staleVerification.workspaceFingerprint,
        latestVerificationVerdict: "blocked",
      };
      return {
        code: "PROGRESS_PHASE",
        disposition: "redirect",
        phase: "repair",
        reason: "验证开始前工作区已发生额外变化；该 pass 已作废，必须重新建立修改范围并验证。",
        tool: staleVerification.tool,
        directive: { action: "verify_or_finish", mutationId: this.activeMutationId },
      };
    }
    const explicitEvidence = actionable.filter(
      (item) => !item.failed && item.progressKind && item.evidenceFingerprint
    );
    for (const evidence of explicitEvidence) {
      if (evidence.progressKind && evidence.evidenceFingerprint && !this.evidenceFingerprints.has(evidence.evidenceFingerprint)) {
        return this.recordProgress({
          phase: this.phase,
          sourceTool: evidence.tool,
          kind: evidence.progressKind,
          fingerprint: evidence.evidenceFingerprint,
          rootCauseId: evidence.rootCauseId
            ?? undefined,
          mutationId: evidence.mutationId,
          verifierId: evidence.verifierId,
          value: 1,
        });
      }
    }
    if (explicitEvidence.length > 0) {
      return this.recordProgress({
        phase: this.phase,
        kind: "no_progress",
        fingerprint: explicitEvidence.map((item) => item.evidenceFingerprint).join("|"),
        value: 0,
      });
    }
    if (actionable.length > 0) {
      return this.recordProgress({
        phase: this.phase,
        kind: "no_progress",
        fingerprint: actionable
          .map((item) => item.actionFingerprint ?? item.failureFingerprint ?? item.tool)
          .join("|"),
        value: 0,
      });
    }
    return null;
  }

  isActionBlocked(actionFingerprint: string): boolean {
    void actionFingerprint;
    return false;
  }

  isToolAllowed(tool: string, args: Record<string, unknown> = {}): boolean {
    void tool;
    void args;
    return true;
  }

  getRecoveryEpisode(): RecoveryEpisode | undefined {
    return this.progressState.recoveryEpisode;
  }

  getProgressState(): Readonly<ProgressState> {
    return {
      ...this.progressState,
      phase: this.phase,
      activeRootCauseId: this.activeRootCauseId ?? undefined,
      activeMutationId: this.activeMutationId ?? this.progressState.activeMutationId,
      activeMutationPaths: this.activeMutationId
        ? [...(this.mutationPaths.get(this.activeMutationId) ?? [])]
        : [...(this.progressState.activeMutationPaths ?? [])],
      activeMutationWorkspaceFingerprint: this.activeMutationWorkspaceFingerprint ?? this.progressState.activeMutationWorkspaceFingerprint,
      pendingSideEffectIds: [...this.pendingSideEffectIds].sort(),
      reconciledSideEffectIds: [...this.reconciledSideEffectIds].sort(),
    };
  }

  getPhase(): ProgressPhase {
    return this.phase;
  }

  getActiveMutationPaths(): string[] {
    return this.activeMutationId ? [...(this.mutationPaths.get(this.activeMutationId) ?? [])] : [];
  }

  canCompact(turn: number): boolean {
    if (this.compactions >= this.maxCompactions) return false;
    if (this.lastCompactionTurn === null) return true;
    return turn - this.lastCompactionTurn >= this.compactionCooldownTurns;
  }

  recordCompaction(turn: number): void {
    this.compactions++;
    this.lastCompactionTurn = turn;
  }

  formatSideEffectLedger(): string {
    if (this.sideEffects.size === 0) return "";
    const labels = {
      created: "创建",
      updated: "更新",
      created_then_updated: "创建后更新",
    } as const;
    const lines = [...this.sideEffects.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([target, mutation]) => `- ${target}：${labels[mutation]}`);
    return [
      "<run_side_effects>",
      "运行时已观测到以下成功文件变更；最终答复必须逐项披露，不得因上下文压缩而遗漏：",
      ...lines,
      "</run_side_effects>",
    ].join("\n");
  }
}
