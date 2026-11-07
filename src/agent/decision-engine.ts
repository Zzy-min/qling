// ============================================================
// 结构化决策循环、7维复杂度策略路由与自主策略切换引擎 (Decision Engine)
// 参考 grok-build Agent Loop / goal_classifier / goal_strategist / doom_loop_recovery
// ============================================================

import type {
  DecisionRecord,
  DecisionStage,
  ExecutionStrategyTier,
} from "../execution/types.js";
import type { ToolExecutionObservation } from "./run-efficiency.js";

export interface TaskComplexityDimensions {
  estimatedSteps: "single" | "few" | "multi";
  toolDependency: "none" | "single_tool" | "multi_tool" | "orchestrated";
  uncertainty: "low" | "medium" | "high";
  externalMutation: "read_only" | "local_write" | "external_or_system";
  riskLevel: "low" | "medium" | "high";
  reversibility: "reversible" | "partially_reversible" | "irreversible";
  successCriteriaClarity: "clear" | "moderate" | "ambiguous";
}

export interface TaskComplexityProfile {
  strategyTier: ExecutionStrategyTier;
  dimensions: TaskComplexityDimensions;
  score: number;
  recommendedStages: DecisionStage[];
  requiresPreExecutionPlan: boolean;
  requiresStrictVerification: boolean;
  requiresApprovalCheck: boolean;
  detectedConstraints: string[];
  conflictingConstraints: string[];
  rationale: string;
}

export interface AssessTaskComplexityOptions {
  availableTools?: string[];
  hasActivePlan?: boolean;
  sessionTurnCount?: number;
  requireWorkspaceMutation?: boolean;
}

const HIGH_RISK_RE =
  /(?:rm\s+-rf|git\s+push\s+--force|git\s+reset\s+--hard|drop\s+table|delete\s+from|truncate\s+table|format\s+disk|chmod\s+777|deploy\s+to\s+prod|production\s+database|publish\s+package|npm\s+publish|强制推送|删除数据库|清空生产|格式化磁盘|删除所有文件|不可逆|生产环境部署|卸载系统)/i;

const MULTI_STEP_RE =
  /(?:refactor|architect|migrate|redesign|end-to-end|pipeline|multi-step|step\s+by\s+step|comprehensive|systematic|phase\s+1|阶段一|系统性重构|全面重构|分阶段|多步骤|架构重构|全链路|完整实现并验证|端到端)/i;

const CODE_OR_WRITE_RE =
  /(?:implement|fix\s+bug|create\s+file|write\s+file|modify|update\s+code|add\s+feature|add\s+test|patch|build|compile|修复|实现|编写|修改代码|创建文件|写入文件|重构|新增功能|添加测试)/i;

const READ_ONLY_SIMPLE_RE =
  /^(?:what\s+is|who\s+is|explain|summarize|read\s+|show\s+me|cat\s+|list\s+|check\s+status|git\s+status|pwd|ls\b|version\b|查看|读取|解释|什么是|列出|当前版本|检查状态)/i;

const HIGH_UNCERTAINTY_RE =
  /(?:investigate|diagnose|root\s+cause|intermittent|flaky|unknown|why\s+does|explore|research|排查|定位根因|为什么会|偶发|未知错误|调研|深度研究)/i;

const AMBIGUOUS_CRITERIA_RE =
  /(?:make\s+it\s+better|optimize\s+everything|improve\s+quality|尽可能优化|全面提升|改得更好)/i;

/**
 * 从用户任务描述中提取显式工程约束（如“禁止…”、“不得…”、“不要…”、“必须…”、“只读”等），
 * 以便写入 DecisionLedger 并在长上下文压缩后持续保留。
 */
export function extractPromptConstraints(prompt: string): string[] {
  const text = String(prompt ?? "").trim();
  if (!text) return [];
  const clauses = text
    .split(/[。！？；.!?\n]+/)
    .map((c) => c.trim())
    .filter(Boolean);
  const matched: string[] = [];
  const constraintRe =
    /(?:禁止|不得|不要|严禁|切勿|不能|必须|只允许|仅限|只读|不可|must\s+not|do\s+not|don't|never|read-only|without\s+modifying)/i;
  for (const clause of clauses) {
    if (constraintRe.test(clause)) {
      const normalized = clause.replace(/^[-*•\d.)、\s]+/, "").trim().slice(0, 160);
      if (normalized && !matched.includes(normalized)) {
        matched.push(normalized);
      }
    }
    if (matched.length >= 8) break;
  }
  return matched;
}

/**
 * 检测用户指令中自相矛盾的冲突约束（例如“只读/禁止修改任何文件”同时要求“直接修改源码文件”）。
 */
export function detectConflictingConstraints(prompt: string): string[] {
  const text = String(prompt ?? "").trim();
  if (!text) return [];
  const conflicts: string[] = [];

  const forbidsFileMutation =
    /(?:禁止|不得|不要|严禁)(?:修改|写入|创建|改动|变更)(?:任何)?(?:文件|代码|源码)|只读模式|read-only\s+mode|do\s+not\s+(?:modify|write|create)\s+any\s+files?/i.test(
      text,
    );
  const demandsFileMutation =
    /(?:请|直接|立即|并)?(?:修改|写入|创建|新建|重写|覆盖)\s*(?:文件|代码)?\s*[`"']?[A-Za-z0-9_./\\-]+\.[A-Za-z0-9]{1,8}[`"']?|(?:创建|写入)(?:新)?文件|write\s+to\s+file|modify\s+the\s+file/i.test(
      text,
    );
  if (forbidsFileMutation && demandsFileMutation) {
    conflicts.push("只读/禁止修改文件约束与创建或修改目标文件的要求冲突");
  }

  const forbidsNetwork =
    /(?:禁止|不得|不要|严禁)(?:使用|发起|访问)?(?:外部)?网络|纯离线|offline\s+only|no\s+network/i.test(
      text,
    );
  const demandsNetwork =
    /(?:抓取|请求|访问|调用|推送到?)\s*(?:远程|外部|线上|https?:\/\/)|git\s+push|curl\s+https?:\/\//i.test(
      text,
    );
  if (forbidsNetwork && demandsNetwork) {
    conflicts.push("禁止网络访问约束与访问/推送远程网络资源的要求冲突");
  }

  const demandsDeleteAll =
    /(?:清空|删除|销毁)(?:所有|全部)(?:历史)?(?:数据|表|记录|文件)|drop\s+table|truncate\s+table/i.test(
      text,
    );
  const forbidsDeleteAny =
    /(?:保留|不得删除|禁止删除|不可丢失)(?:所有|全部|任何)(?:历史)?(?:数据|表|记录|文件)/i.test(
      text,
    );
  if (demandsDeleteAll && forbidsDeleteAny) {
    conflicts.push("清空/删除全部数据的要求与保留全部历史数据不可删除的约束冲突");
  }

  return conflicts;
}

/**
 * 综合 7 个工程维度评估任务复杂度并路由执行策略，而非仅按字数判断。
 */
export function assessTaskComplexity(
  prompt: string,
  options: AssessTaskComplexityOptions = {},
): TaskComplexityProfile {
  const text = String(prompt ?? "").trim();
  const detectedConstraints = extractPromptConstraints(text);
  const conflictingConstraints = detectConflictingConstraints(text);
  const hasConflicts = conflictingConstraints.length > 0;

  // 1. 高危与不可逆检测
  const isHighRisk = HIGH_RISK_RE.test(text);
  const reversibility: TaskComplexityDimensions["reversibility"] = isHighRisk
    ? "irreversible"
    : CODE_OR_WRITE_RE.test(text) || options.requireWorkspaceMutation
      ? "partially_reversible"
      : "reversible";
  const riskLevel: TaskComplexityDimensions["riskLevel"] = isHighRisk
    ? "high"
    : reversibility === "partially_reversible" || hasConflicts
      ? "medium"
      : "low";

  // 2. 操作步骤数量估计
  const bulletOrNumberedCount = (
    text.match(/(?:^|\n)\s*(?:[-*•]|\d+[.)、]|[一二三四五六七八九十]+[、.])/g) ?? []
  ).length;
  const clauseMarkers = (
    text.match(/(?:\bthen\b|\bafter\s+that\b|\bfinally\b|\band\s+then\b|然后|接着|随后|最后|同时|并且验证)/gi) ?? []
  ).length;

  let estimatedSteps: TaskComplexityDimensions["estimatedSteps"] = "single";
  if (
    options.hasActivePlan ||
    MULTI_STEP_RE.test(text) ||
    bulletOrNumberedCount >= 4 ||
    clauseMarkers >= 3
  ) {
    estimatedSteps = "multi";
  } else if (
    CODE_OR_WRITE_RE.test(text) ||
    HIGH_UNCERTAINTY_RE.test(text) ||
    hasConflicts ||
    bulletOrNumberedCount >= 2 ||
    clauseMarkers >= 1 ||
    options.requireWorkspaceMutation
  ) {
    estimatedSteps = "few";
  }

  // 3. 外部环境变更与副作用
  const externalMutation: TaskComplexityDimensions["externalMutation"] = isHighRisk
    ? "external_or_system"
    : CODE_OR_WRITE_RE.test(text) || options.requireWorkspaceMutation
      ? "local_write"
      : "read_only";

  // 4. 工具依赖程度
  let toolDependency: TaskComplexityDimensions["toolDependency"] = "none";
  if (estimatedSteps === "multi" || (externalMutation !== "read_only" && HIGH_UNCERTAINTY_RE.test(text))) {
    toolDependency = "orchestrated";
  } else if (externalMutation === "local_write" || estimatedSteps === "few") {
    toolDependency = "multi_tool";
  } else if (text.length > 0) {
    toolDependency = "single_tool";
  }

  // 5. 不确定性
  const uncertainty: TaskComplexityDimensions["uncertainty"] =
    HIGH_UNCERTAINTY_RE.test(text) || hasConflicts
      ? "high"
      : estimatedSteps === "multi"
        ? "medium"
        : "low";

  // 6. 成功标准清晰度
  const successCriteriaClarity: TaskComplexityDimensions["successCriteriaClarity"] =
    AMBIGUOUS_CRITERIA_RE.test(text) || hasConflicts
      ? "ambiguous"
      : /(?:test|verify|assert|benchmark|通过测试|验证|验收标准|输出格式)/i.test(text)
        ? "clear"
        : "moderate";

  // 7. 计算综合得分与策略层级
  let score = 0;
  if (estimatedSteps === "few") score += 2;
  if (estimatedSteps === "multi") score += 5;
  if (toolDependency === "multi_tool") score += 2;
  if (toolDependency === "orchestrated") score += 4;
  if (uncertainty === "medium") score += 2;
  if (uncertainty === "high") score += 3;
  if (externalMutation === "local_write") score += 2;
  if (externalMutation === "external_or_system") score += 5;
  if (riskLevel === "medium") score += 1;
  if (riskLevel === "high") score += 5;
  if (reversibility === "irreversible") score += 4;
  if (successCriteriaClarity === "ambiguous") score += 2;
  if (hasConflicts) score += 2;

  let strategyTier: ExecutionStrategyTier;
  if (isHighRisk || riskLevel === "high" || reversibility === "irreversible") {
    strategyTier = "high_risk";
  } else if (
    estimatedSteps === "multi" ||
    toolDependency === "orchestrated" ||
    score >= 9 ||
    options.hasActivePlan
  ) {
    strategyTier = "full_plan";
  } else if (
    !hasConflicts &&
    ((READ_ONLY_SIMPLE_RE.test(text) && estimatedSteps === "single" && externalMutation === "read_only") ||
      score <= 3)
  ) {
    strategyTier = "fast_path";
  } else {
    strategyTier = "light_plan";
  }

  const recommendedStages: DecisionStage[] = (() => {
    switch (strategyTier) {
      case "fast_path":
        return ["understand", "act", "verify", "finish"];
      case "light_plan":
        return ["understand", "gather", "plan_decide", "act", "observe", "verify", "finish"];
      case "full_plan":
      case "high_risk":
        return [
          "understand",
          "gather",
          "analyze",
          "plan_decide",
          "act",
          "observe",
          "verify",
          "update_replan",
          "finish",
        ];
    }
  })();

  const dimensions: TaskComplexityDimensions = {
    estimatedSteps,
    toolDependency,
    uncertainty,
    externalMutation,
    riskLevel,
    reversibility,
    successCriteriaClarity,
  };

  const rationale =
    `strategy=${strategyTier} (score=${score}, steps=${estimatedSteps}, ` +
    `tools=${toolDependency}, uncertainty=${uncertainty}, mutation=${externalMutation}, ` +
    `risk=${riskLevel}, reversibility=${reversibility}` +
    (hasConflicts ? `, conflicts=${conflictingConstraints.length}` : "") +
    `)`;

  return {
    strategyTier,
    dimensions,
    score,
    recommendedStages,
    requiresPreExecutionPlan: strategyTier === "full_plan" || strategyTier === "high_risk",
    requiresStrictVerification:
      strategyTier === "high_risk" ||
      strategyTier === "full_plan" ||
      externalMutation !== "read_only",
    requiresApprovalCheck: strategyTier === "high_risk" || hasConflicts,
    detectedConstraints,
    conflictingConstraints,
    rationale,
  };
}

/**
 * 可观测的结构化决策账本（DecisionLedger）。
 * 记录每轮关键决策的目标、已知事实、关键约束、选定操作、依据摘要、预期/实际结果、验证状态与下一步行动。
 * 不伪造或暴露模型隐藏的原始思维链。
 */
export class DecisionLedger {
  private readonly records: DecisionRecord[] = [];
  private readonly goal: string;
  private strategyTier: ExecutionStrategyTier;
  private knownFacts = new Set<string>();
  private constraints = new Set<string>();
  private currentStage: DecisionStage = "understand";

  constructor(options: {
    goal: string;
    strategyTier: ExecutionStrategyTier;
    initialConstraints?: string[];
  }) {
    const rawGoal = String(options.goal ?? "").trim();
    this.goal = rawGoal.slice(0, 300) || "完成用户任务";
    this.strategyTier = options.strategyTier;
    for (const c of extractPromptConstraints(rawGoal)) {
      this.constraints.add(c);
    }
    for (const conflict of detectConflictingConstraints(rawGoal)) {
      this.constraints.add(`[冲突约束] ${conflict}`);
    }
    for (const c of options.initialConstraints ?? []) {
      if (c.trim()) this.constraints.add(c.trim());
    }
  }

  getStrategyTier(): ExecutionStrategyTier {
    return this.strategyTier;
  }

  setStrategyTier(tier: ExecutionStrategyTier): void {
    this.strategyTier = tier;
  }

  getCurrentStage(): DecisionStage {
    return this.currentStage;
  }

  addKnownFact(fact: string): void {
    const trimmed = String(fact ?? "").trim();
    if (!trimmed) return;
    if (this.knownFacts.size >= 16) {
      const oldest = this.knownFacts.values().next().value;
      if (oldest) this.knownFacts.delete(oldest);
    }
    this.knownFacts.add(trimmed.slice(0, 200));
  }

  addConstraint(constraint: string): void {
    const trimmed = String(constraint ?? "").trim();
    if (!trimmed) return;
    this.constraints.add(trimmed.slice(0, 200));
  }

  recordDecision(input: {
    turn: number;
    stage: DecisionStage;
    selectedAction: string;
    rationaleSummary: string;
    expectedOutcome: string;
    actualOutcome: string;
    verificationStatus?: DecisionRecord["verificationStatus"];
    nextStep?: DecisionRecord["nextStep"];
    timestamp?: number;
  }): DecisionRecord {
    this.currentStage = input.stage;
    const record: DecisionRecord = {
      turn: input.turn,
      stage: input.stage,
      strategy: this.strategyTier,
      goal: this.goal,
      knownFacts: Array.from(this.knownFacts).slice(-6),
      constraints: Array.from(this.constraints).slice(-6),
      selectedAction: input.selectedAction.slice(0, 240),
      rationaleSummary: input.rationaleSummary.slice(0, 280),
      expectedOutcome: input.expectedOutcome.slice(0, 240),
      actualOutcome: input.actualOutcome.slice(0, 280),
      verificationStatus: input.verificationStatus ?? "unverified",
      nextStep: input.nextStep ?? "continue",
      timestamp: input.timestamp ?? Date.now(),
    };
    this.records.push(record);
    return record;
  }

  /**
   * 根据本轮工具观察结果自动推断所处决策阶段并记录结构化决策。
   */
  recordTurnObservations(input: {
    turn: number;
    observations: ToolExecutionObservation[];
    verificationVerdict?: "pass" | "fail" | "unverified";
    strategyShifted?: boolean;
  }): DecisionRecord {
    const { turn, observations, verificationVerdict, strategyShifted } = input;
    const tools = observations.map((o) => o.tool);
    const failures = observations.filter((o) => o.failed);
    const hasWrite = observations.some(
      (o) =>
        o.progressKind === "successful_mutation" ||
        Boolean(o.mutation) ||
        (!o.failed &&
          (o.tool === "write" ||
            o.tool === "patch" ||
            o.tool === "patch_anchored" ||
            o.tool === "edit_file" ||
            o.tool === "write_file")),
    );
    const hasVerify = observations.some(
      (o) => o.tool === "verify" || o.progressKind === "verification_delta",
    );
    const hasPlan = observations.some((o) => o.tool === "planner" || o.tool === "todo");
    const hasGather = observations.some(
      (o) =>
        o.tool === "read" ||
        o.tool === "read_file" ||
        o.tool === "read_anchored" ||
        o.tool === "search" ||
        o.tool === "search_files" ||
        o.tool === "list_dir" ||
        o.tool === "repo_map" ||
        o.tool === "repo_query" ||
        o.tool === "code_symbols" ||
        o.tool === "impact_analysis" ||
        o.tool === "lsp" ||
        o.tool === "url_fetch" ||
        o.tool === "deepseek_search" ||
        o.tool === "deepseek_fetch" ||
        o.tool === "browser_fetch" ||
        o.tool === "tool_search",
    );

    for (const obs of observations) {
      if (!obs.failed && obs.targetPath) {
        this.addKnownFact(`已检查/操作路径 ${obs.targetPath} (${obs.tool})`);
      }
      if (obs.failed && obs.failureFingerprint) {
        this.addConstraint(`避免重复失败: ${obs.tool} (${obs.failureFingerprint.slice(0, 80)})`);
      }
    }

    let stage: DecisionStage = "act";
    if (strategyShifted) {
      stage = "update_replan";
    } else if (hasVerify || verificationVerdict === "pass" || verificationVerdict === "fail") {
      stage = "verify";
    } else if (hasPlan) {
      stage = "plan_decide";
    } else if (hasGather && !hasWrite) {
      stage = turn <= 1 ? "gather" : "analyze";
    } else if (hasWrite) {
      stage = "act";
    } else {
      stage = "observe";
    }

    const selectedAction =
      tools.length > 0 ? `执行工具 [${tools.join(", ")}]` : "模型推理与状态评估";
    const rationaleSummary =
      stage === "gather"
        ? "收集工作区上下文与目标文件事实"
        : stage === "analyze"
          ? "分析代码结构与约束条件"
          : stage === "plan_decide"
            ? "制定或更新结构化任务计划"
            : stage === "verify"
              ? "执行确定性验证以检验交付质量"
              : stage === "update_replan"
                ? "检测到无效循环或阻碍，触发策略切换与重规划"
                : "推进当前子任务执行";

    const expectedOutcome = hasWrite
      ? "完成目标文件修改并准备验证"
      : hasVerify
        ? "验证通过并产出可审计证据"
        : "获取推进下一步所需的准确上下文";

    const actualOutcome =
      failures.length === 0
        ? `成功执行 ${observations.length} 个操作`
        : `${failures.length}/${observations.length} 个操作失败 (${failures.map((f) => f.tool).join(", ")})`;

    const verificationStatus: DecisionRecord["verificationStatus"] =
      verificationVerdict === "pass"
        ? "pass"
        : verificationVerdict === "fail"
          ? "fail"
          : failures.length > 0
            ? "fail"
            : "unverified";

    const nextStep: DecisionRecord["nextStep"] = strategyShifted
      ? "switch_strategy"
      : verificationVerdict === "fail" || failures.length > 0
        ? "replan"
        : hasWrite && verificationVerdict !== "pass"
          ? "verify"
          : "continue";

    return this.recordDecision({
      turn,
      stage,
      selectedAction,
      rationaleSummary,
      expectedOutcome,
      actualOutcome,
      verificationStatus,
      nextStep,
    });
  }

  getRecords(): DecisionRecord[] {
    return [...this.records];
  }

  getLatestRecord(): DecisionRecord | undefined {
    return this.records[this.records.length - 1];
  }

  getConstraints(): string[] {
    return [...this.constraints];
  }

  formatDecisionLedgerBlock(maxRecords = 5): string {
    if (this.records.length === 0) return "";
    const recent = this.records.slice(-maxRecords);
    const lines = [
      `<decision_ledger strategy="${this.strategyTier}" stage="${this.currentStage}">`,
      `目标: ${this.goal}`,
    ];
    if (this.constraints.size > 0) {
      lines.push(`关键约束: ${Array.from(this.constraints).slice(-6).join(" | ")}`);
    }
    for (const r of recent) {
      lines.push(
        `- [Turn ${r.turn}][${r.stage}] 动作=${r.selectedAction} | 结果=${r.actualOutcome} | 验证=${r.verificationStatus} | 下一步=${r.nextStep}`,
      );
    }
    lines.push(`</decision_ledger>`);
    return lines.join("\n");
  }
}

export interface StallStrategyAnalysis {
  failureRootCause: string;
  strategyEffective: boolean;
  effectivenessDiagnosis: string;
  alternativeTools: string[];
  alternativeApproach: string;
  shouldReplan: boolean;
  shouldTerminateSafely: boolean;
  terminationReason?: string;
  formattedGuidanceBlock: string;
}

/**
 * 当 Agent 连续执行相似操作或反复失败无进展时，执行：
 * 1. 失败原因分析
 * 2. 当前策略有效性检查
 * 3. 替代执行路径搜索
 * 4. 必要时调整计划建议
 * 5. 达到限制时安全终止判定
 */
export function analyzeStallAndStrategyShift(input: {
  failedTool?: string;
  failureFingerprint?: string;
  consecutiveFailures: number;
  noProgressTurns: number;
  maxNoProgressTurns?: number;
  attemptedTools?: string[];
  hasActivePlan?: boolean;
}): StallStrategyAnalysis {
  const maxNoProgress = input.maxNoProgressTurns ?? 12;
  const tool = input.failedTool ?? "unknown_tool";
  const fp = input.failureFingerprint ?? "repeated_unproductive_action";

  // 1. 失败根因分析
  let failureRootCause = `工具 ${tool} 连续受阻 (${fp.slice(0, 120)})`;
  if (/^(?:patch|edit_file|patch_anchored|write|write_file)$/.test(tool)) {
    failureRootCause = `编辑工具 ${tool} 锚点或目标行不匹配，继续盲目修补会导致补丁漂移`;
  } else if (/^bash$/.test(tool)) {
    failureRootCause = `命令执行 (${tool}) 连续失败或无状态推进，可能是命令参数、路径或环境依赖不满足`;
  } else if (/^(?:read|search|read_file|search_files|list_dir)$/.test(tool)) {
    failureRootCause = `只读探索 (${tool}) 连续 ${input.noProgressTurns} 轮未产生新事实或定位结论`;
  }

  // 2. 当前策略有效性检查
  const strategyEffective = input.consecutiveFailures < 2 && input.noProgressTurns < 4;
  const effectivenessDiagnosis = strategyEffective
    ? "当前策略仍处于正常探索窗口内"
    : `当前策略已失效（连续失败 ${input.consecutiveFailures} 次，无进展 ${input.noProgressTurns} 轮），禁止原样重试`;

  // 3. 替代执行路径搜索（返回真实 Qling 工具链名称）
  let alternativeTools: string[] = [];
  let alternativeApproach = "";
  if (/^(?:patch|edit_file)$/.test(tool)) {
    alternativeTools = ["read_anchored", "patch_anchored"];
    alternativeApproach =
      "先使用 read_anchored 获取带行号与锚点哈希的最新片段，再调用 patch_anchored 精确替换";
  } else if (/^patch_anchored$/.test(tool)) {
    alternativeTools = ["read_anchored", "write"];
    alternativeApproach =
      "重新调用 read_anchored 刷新行锚点；若文件较小且结构重排，可完整校验后使用 write";
  } else if (/^bash$/.test(tool)) {
    alternativeTools = ["read", "search", "verify"];
    alternativeApproach =
      "停止重复运行失败的 shell 命令；优先使用结构化文件/搜索工具 (read / search) 检查配置与源码，再用 verify 验证";
  } else if (/^(?:read|search|read_file|search_files|list_dir)$/.test(tool)) {
    alternativeTools = ["repo_map", "repo_query", "planner"];
    alternativeApproach =
      "停止随机文件浏览；使用 repo_map/repo_query 全局定位符号，并收敛到目标文件进行修改";
  } else {
    alternativeTools = ["read_anchored", "search", "planner"];
    alternativeApproach =
      "切换工具路径：先核对输入参数与前置文件状态，必要时拆分步骤";
  }

  // 4. 是否需要更新计划
  const shouldReplan =
    !strategyEffective && (Boolean(input.hasActivePlan) || input.noProgressTurns >= 5);

  // 5. 是否达到限制需要安全终止
  const shouldTerminateSafely = input.noProgressTurns >= maxNoProgress;
  const terminationReason = shouldTerminateSafely
    ? `连续 ${input.noProgressTurns} 轮无实质进展（达到上限 ${maxNoProgress}），触发安全熔断以避免无限重试`
    : undefined;

  const formattedGuidanceBlock = [
    `<strategy_shift>`,
    `1. 失败根因分析: ${failureRootCause}`,
    `2. 策略有效性评估: ${effectivenessDiagnosis}`,
    `3. 替代执行路径: 建议改用 [${alternativeTools.join(" → ")}] — ${alternativeApproach}`,
    shouldReplan
      ? `4. 计划调整指令: 当前路径受阻，请调用 planner (action="replan") 或 todo 更新剩余子任务，保留已验证完成的步骤。`
      : `4. 计划调整指令: 修正当前操作参数后继续推进。`,
    `</strategy_shift>`,
  ].join("\n");

  return {
    failureRootCause,
    strategyEffective,
    effectivenessDiagnosis,
    alternativeTools,
    alternativeApproach,
    shouldReplan,
    shouldTerminateSafely,
    ...(terminationReason ? { terminationReason } : {}),
    formattedGuidanceBlock,
  };
}

export const analyzeLoopStallAndStrategyShift = analyzeStallAndStrategyShift;
export const analyzeStallAndSuggestStrategy = analyzeStallAndStrategyShift;
