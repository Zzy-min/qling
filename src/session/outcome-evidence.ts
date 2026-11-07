import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { TaskCompletionStatus } from "../execution/types.js";
import type { StructuredTaskPlan } from "../plan/task-plan.js";
import { summarizeTaskPlan } from "../plan/task-plan.js";
import {
  detectPrematureStopDetailed,
  type PrematureStopDetailedMatch,
} from "./premature-stop.js";

export type { TaskCompletionStatus };
export type EvidenceVerdict = "pass" | "fail" | "partial" | "unknown";
export type EvidenceSource =
  | "command"
  | "tool"
  | "filesystem"
  | "git"
  | "process"
  | "http"
  | "rule"
  | "llm_judge"
  | "side_effect";
export type DeliverableVerifier =
  | "file"
  | "git_diff"
  | "syntax"
  | "command"
  | "http"
  | "process"
  | "rule";

export interface DeliverableContract {
  id: string;
  claim: string;
  verifier?: DeliverableVerifier;
  required: boolean;
  freshnessMs?: number;
  /** @deprecated Use freshnessMs. */
  maxAgeMs?: number;
  allowLlmJudge?: boolean;
}

export interface EvidenceRecord {
  id: string;
  claim: string;
  source: EvidenceSource;
  commandOrTool?: string;
  artifactHash?: string;
  observedAt: number;
  verdict: EvidenceVerdict;
  scope: string;
  deterministic: boolean;
  redacted: boolean;
  sideEffect?: "none" | "workspace" | "process" | "network" | "external";
}

export interface OutcomeContract {
  objective: string;
  deliverables: DeliverableContract[];
  prohibitedSideEffects: Array<"workspace" | "process" | "network" | "external">;
  budget: {
    maxWallClockMs?: number;
    maxTokens?: number;
    maxToolCalls?: number;
    maxFailures?: number;
  };
}

export interface OutcomeEvaluation {
  status: "active" | "achieved" | "blocked";
  reason: string;
  missing: string[];
  failed: string[];
}

export class EvidenceLedger {
  private readonly records: EvidenceRecord[] = [];
  private readonly now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  record(
    input: Omit<EvidenceRecord, "id" | "redacted"> & { id?: string; redacted?: boolean }
  ): EvidenceRecord {
    const record: EvidenceRecord = {
      ...input,
      id: input.id ?? `evidence_${randomUUID()}`,
      redacted: input.redacted ?? false,
      observedAt: input.observedAt ?? this.now(),
    };
    this.records.push(record);
    return { ...record };
  }

  list(): EvidenceRecord[] {
    return this.records.map((record) => ({ ...record }));
  }
}

export function evaluateOutcomeContract(
  contract: OutcomeContract,
  evidence: readonly EvidenceRecord[],
  options: { now?: number } = {}
): OutcomeEvaluation {
  const now = options.now ?? Date.now();
  const prohibited = evidence.find(
    (record) =>
      record.source === "side_effect" &&
      record.sideEffect !== undefined &&
      contract.prohibitedSideEffects.includes(
        record.sideEffect as "workspace" | "process" | "network" | "external"
      )
  );
  if (prohibited) {
    return {
      status: "blocked",
      reason: `prohibited side effect observed: ${prohibited.sideEffect}`,
      missing: [],
      failed: [prohibited.claim],
    };
  }

  const missing: string[] = [];
  const failed: string[] = [];
  for (const deliverable of contract.deliverables.filter((item) => item.required)) {
    const freshnessMs = deliverable.freshnessMs ?? deliverable.maxAgeMs;
    const matching = evidence
      .filter((record) => record.claim === deliverable.claim)
      .filter((record) => freshnessMs === undefined || now - record.observedAt <= freshnessMs)
      .filter((record) => {
        if (!deliverable.verifier) return true;
        const expectedSources: Record<DeliverableVerifier, EvidenceSource[]> = {
          file: ["filesystem"],
          git_diff: ["git"],
          syntax: ["command", "tool"],
          command: ["command", "tool"],
          http: ["http"],
          process: ["process"],
          rule: ["rule"],
        };
        return expectedSources[deliverable.verifier].includes(record.source);
      })
      .sort((left, right) => right.observedAt - left.observedAt);
    if (matching.some((record) => record.deterministic && record.verdict === "fail")) {
      failed.push(deliverable.claim);
      continue;
    }
    const passing = matching.some(
      (record) =>
        record.verdict === "pass" &&
        (record.deterministic ||
          (deliverable.allowLlmJudge === true && record.source === "llm_judge"))
    );
    if (!passing) missing.push(deliverable.claim);
  }

  if (failed.length > 0) {
    return {
      status: "blocked",
      reason: `deterministic evidence failed: ${failed.join(", ")}`,
      missing,
      failed,
    };
  }
  if (missing.length > 0) {
    return {
      status: "active",
      reason: `required evidence missing or stale: ${missing.join(", ")}`,
      missing,
      failed,
    };
  }
  return {
    status: "achieved",
    reason: "all required deliverables have fresh passing evidence",
    missing,
    failed,
  };
}

// ============================================================
// 阶段四：独立结果判定体系 (Result Evaluator & Pre-Final Self-Check Gate)
// ============================================================

export type TaskDomainKind =
  | "file_operation"
  | "code_development"
  | "information_retrieval"
  | "data_processing"
  | "multi_step_automation"
  | "general_qa";

export interface ToolExecutionEvidenceItem {
  tool: string;
  /** Original executed command and exit status, never inferred from assistant prose. */
  command?: string;
  exitCode?: number | null;
  verificationKind?: "test" | "build" | "lint" | "typecheck" | "general";
  verificationBaseFingerprint?: string;
  workspaceFingerprint?: string;
  targetPath?: string;
  changedPaths?: string[];
  output?: string;
  failed: boolean;
  /** Permission/approval refusal: the tool never ran, so it is not execution failure. */
  blocked?: boolean;
  mutation?: "created" | "updated";
  isVerification?: boolean;
  verificationVerdict?: "pass" | "fail" | "blocked";
}

export interface ClaimAuditFinding {
  kind:
    | "unbacked_file_mutation_claim"
    | "missing_target_file_on_disk"
    | "empty_target_file_on_disk"
    | "invalid_file_format_on_disk"
    | "unbacked_verification_claim"
    | "unresolved_tool_failure";
  claim: string;
  detail: string;
}

export interface TodoCompletionState {
  total: number;
  completed: number;
  pending: number;
  inProgress: number;
  pendingTitles: string[];
}

export interface ResultEvaluationInput {
  userPrompt: string;
  finalText: string;
  workspaceDir?: string | null;
  toolExecutions: readonly ToolExecutionEvidenceItem[];
  activeMutationId?: string;
  latestVerificationVerdict?: "pass" | "fail" | "blocked";
  activePlan?: StructuredTaskPlan | null;
  todoState?: TodoCompletionState | null;
  outcomeContract?: OutcomeContract | null;
  evidenceRecords?: readonly EvidenceRecord[];
  requireDeterministicVerification?: boolean;
  /** Explicit opt-out for hosts that own their own completion policy (SDK/tests). */
  enforce?: boolean;
}

export interface ResultEvaluationReport {
  completionStatus: TaskCompletionStatus;
  domain: TaskDomainKind;
  verified: boolean;
  allowFinish: boolean;
  summary: string;
  evidence: string[];
  unmetCriteria: string[];
  claimAuditFindings: ClaimAuditFinding[];
  prematureStop: PrematureStopDetailedMatch | null;
  remediationPrompt?: string;
}

const MUTATION_TOOLS = new Set(["write", "patch", "patch_anchored", "edit", "notebook_edit"]);
const READ_SEARCH_TOOLS = new Set([
  "read",
  "read_anchored",
  "search",
  "glob",
  "ls",
  "repo_map",
  "repo_query",
  "code_symbols",
  "impact_analysis",
  "web_search",
  "web_fetch",
]);

export function classifyTaskDomain(
  userPrompt: string,
  toolsUsed: readonly string[] = []
): TaskDomainKind {
  const prompt = userPrompt.trim();
  const lower = prompt.toLowerCase();
  const hasMutationTool = toolsUsed.some((t) => MUTATION_TOOLS.has(t));

  if (
    /(?:分步|多步骤|依次|先.*再.*最后|step\s*by\s*step|pipeline|workflow|自动化流程)/i.test(prompt) &&
    toolsUsed.length >= 3
  ) {
    return "multi_step_automation";
  }
  if (
    /(?:修复|重构|实现|编写代码|单元测试|编译|构建|bug|fix|refactor|implement|test|compile|typescript|python|rust)/i.test(
      prompt
    ) ||
    toolsUsed.includes("verify") ||
    toolsUsed.includes("patch") ||
    toolsUsed.includes("patch_anchored")
  ) {
    return "code_development";
  }
  if (
    /(?:创建文件|新建文件|写入文件|修改文件|保存为|重命名|删除文件|create\s+file|write\s+to\s+file|save\s+to)/i.test(
      prompt
    ) ||
    hasMutationTool
  ) {
    return "file_operation";
  }
  if (
    /(?:统计|汇总|计算|转换|解析\s*(?:csv|json|日志|数据)|清洗|聚合|parse|aggregate|calculate|dataset)/i.test(
      prompt
    )
  ) {
    return "data_processing";
  }
  if (
    /(?:查找|搜索|检索|查询|分析.*源码|列出|find|search|locate|list\s+all|inspect)/i.test(prompt) ||
    toolsUsed.some((t) => READ_SEARCH_TOOLS.has(t))
  ) {
    return "information_retrieval";
  }
  return "general_qa";
}

function extractClaimedFilePaths(text: string): string[] {
  const paths = new Set<string>();
  const patterns = [
    /(?:已创建|已写入|已生成|已保存|已修改|已更新|创建了|写入了|生成了|修改了|更新了)\s*(?:文件\s*)?[`"']?([A-Za-z0-9_./\\-]+\.[A-Za-z0-9]{1,8})[`"']?/g,
    /(?:created|wrote|written\s+to|updated|modified|saved\s+to)\s+(?:file\s+)?[`"']?([A-Za-z0-9_./\\-]+\.[A-Za-z0-9]{1,8})[`"']?/gi,
  ];
  for (const regex of patterns) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const candidate = match[1]?.trim();
      if (
        candidate &&
        !candidate.startsWith("http") &&
        !/^(?:e\.g\.|i\.e\.|etc\.|node\.js|v\d+\.\d+)$/i.test(candidate)
      ) {
        paths.add(candidate);
      }
    }
  }
  return [...paths];
}

function extractPromptTargetFilePaths(prompt: string): string[] {
  const paths = new Set<string>();
  const patterns = [
    /(?:创建|新建|修改|更新|写入到|写入|生成|保存(?:为|到)?)\s*(?:文件\s*)?[`"']?([A-Za-z0-9_./\\-]+\.[A-Za-z0-9]{1,8})[`"']?/g,
    /(?:create|modify|update|edit|write(?:\s+to)?|save(?:\s+to|\s+as)?)\s+(?:a\s+)?(?:new\s+)?(?:file\s+)?[`"']?([A-Za-z0-9_./\\-]+\.[A-Za-z0-9]{1,8})[`"']?/gi,
  ];
  for (const regex of patterns) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(prompt)) !== null) {
      const candidate = match[1]?.trim();
      if (
        candidate &&
        !candidate.startsWith("http") &&
        !/^(?:e\.g\.|i\.e\.|etc\.|node\.js|v\d+\.\d+)$/i.test(candidate)
      ) {
        paths.add(candidate);
      }
    }
  }
  return [...paths];
}

export function hasHonestPartialOrBlockedReport(text: string): boolean {
  return /(?:部分完成|暂未完成|尚未完成|未完成部分|因.*(?:缺少|未配置|阻塞|无法|无权限)|待.*(?:提供|授权|确认|恢复)后(?:继续|执行)|partially\s+completed|blocked\s+by|remaining\s+steps?\s+(?:are\s+)?(?:blocked|pending|incomplete))/i.test(
    text
  );
}

function hasProseMutationClaim(text: string): boolean {
  return (
    /(?:我已(?:经)?(?:成功)?(?:创建|写入|修改|更新|生成|保存)|文件已(?:创建|写入|修改|保存)|已(?:修改|更新)(?:该|此|这个)?文件|已完成(?:代码|文件)(?:修改|写入|创建))/.test(
      text
    ) ||
    /\bI\s+have\s+(?:successfully\s+)?(?:created|written|updated|modified|saved)\s+(?:the\s+)?(?:file|code|implementation)\b/i.test(
      text
    )
  );
}

type VerificationKind = NonNullable<ToolExecutionEvidenceItem["verificationKind"]>;

/** Conservative command recognition: shell wrappers/control flow cannot prove a check passed. */
function commandVerificationKind(command: string | undefined): VerificationKind | undefined {
  if (!command || /[;&|<>`\r\n]|\$\(|^\s*#/.test(command)) return undefined;
  const normalized = command.trim();
  if (/\s(?:--(?:help|version|dry-run|listTests|collect-only|showConfig|list|if-present)|-[hV])(?:\s|$)/i.test(normalized)) return undefined;
  if (/^(?:(?:npm|pnpm|yarn|bun)(?:\.cmd)?\s+(?:run\s+)?test(?::[\w-]+)?(?:\s|$)|node(?:\.exe)?\s+--test(?:\s|$)|(?:(?:npx|pnpm\s+exec)\s+)?(?:vitest|jest|mocha|pytest)(?:\s|$)|python(?:3)?\s+-m\s+(?:pytest|unittest)(?:\s|$)|cargo\s+test(?:\s|$)|go\s+test(?:\s|$)|dotnet\s+test(?:\s|$))/.test(normalized)) return "test";
  if (/^(?:(?:npm|pnpm|yarn|bun)(?:\.cmd)?\s+(?:run\s+)?build(?::[\w-]+)?(?:\s|$)|cargo\s+build(?:\s|$)|go\s+build(?:\s|$)|dotnet\s+build(?:\s|$))/.test(normalized)) return "build";
  if (/^(?:(?:npm|pnpm|yarn|bun)(?:\.cmd)?\s+(?:run\s+)?lint(?::[\w-]+)?(?:\s|$)|(?:(?:npx|pnpm\s+exec)\s+)?(?:eslint|ruff)(?:\s|$))/.test(normalized)) return "lint";
  if (/^(?:(?:npm|pnpm|yarn|bun)(?:\.cmd)?\s+(?:run\s+)?(?:typecheck|type-check)(?:\s|$)|(?:(?:npx|pnpm\s+exec)\s+)?tsc(?:\s|$))/.test(normalized)) return "typecheck";
  return undefined;
}

function claimedVerificationKinds(text: string): VerificationKind[] {
  const kinds: VerificationKind[] = [];
  if (/(?:测试.{0,16}(?:通过|成功)|通过.{0,8}测试|\btests?\s+(?:(?:all|have|has|they|and|are)\s+)*pass(?:ed)?\b|\bran\s+(?:the\s+)?tests?\s+and\s+(?:they|all)\s+pass(?:ed)?\b)/i.test(text)) kinds.push("test");
  if (/(?:构建.{0,16}(?:通过|成功)|\bbuild\s+(?:passed|succeeded|successful)\b)/i.test(text)) kinds.push("build");
  if (/\blint\s+(?:passed|succeeded)\b/i.test(text)) kinds.push("lint");
  if (/(?:类型检查.{0,12}通过|\btype[ -]?check\s+(?:passed|succeeded)\b)/i.test(text)) kinds.push("typecheck");
  return kinds;
}

function requiredVerificationKinds(prompt: string): VerificationKind[] {
  const kinds = new Set<VerificationKind>();
  for (const clause of prompt.split(/[,，。;；\n]|\bbut\b|但是|但要/i)) {
    if (/(?:怎么|如何|为什么|解释|说明)|\b(?:how (?:do|can|to)|why|explain)\b/i.test(clause)) continue;
    if (/(?:不要|无需|不用|禁止)|\b(?:do not|don't|without|skip)\b/i.test(clause)) continue;
    if (!/(?:运行|执行|跑|验证|检查|^(?:请)?(?:构建|编译)|\b(?:run|execute|verify)\b|^(?:please\s+)?(?:build|compile|lint|typecheck)\b|\btest\s+(?:the|this|my)\b)/i.test(clause.trim())) continue;
    if (/(?:测试|\btests?\b|pytest|vitest|jest|--test)/i.test(clause)) kinds.add("test");
    if (/(?:构建|编译|\bbuild\b|\bcompile\b)/i.test(clause)) kinds.add("build");
    if (/\blint\b/i.test(clause)) kinds.add("lint");
    if (/(?:类型检查|\btype[ -]?check\b)/i.test(clause)) kinds.add("typecheck");
  }
  return [...kinds];
}

/** Latest check of each kind after the last mutation wins; an old pass cannot hide a failure. */
function freshVerificationEvidence(items: readonly ToolExecutionEvidenceItem[]): Map<VerificationKind, ToolExecutionEvidenceItem> {
  const latest = new Map<VerificationKind, ToolExecutionEvidenceItem>();
  for (const item of items) {
    if (item.mutation || MUTATION_TOOLS.has(item.tool)) latest.clear();
    if (item.tool !== "bash" && item.tool !== "verify") continue;
    const commandKind = commandVerificationKind(item.command);
    if (item.tool === "verify" && !commandKind && (item.failed || item.verificationVerdict === "blocked" || item.verificationVerdict === "fail")) latest.clear();
    const kind = commandKind ?? (item.tool === "verify" && item.command && item.verificationVerdict === "pass" ? "general" : undefined);
    if (!kind) continue;
    latest.set(kind, item);
  }
  for (const [kind, item] of latest) {
    const stable = !item.verificationBaseFingerprint || !item.workspaceFingerprint || item.verificationBaseFingerprint === item.workspaceFingerprint;
    const exitedSuccessfully = item.exitCode === 0;
    if (item.failed || item.verificationVerdict === "fail" || item.verificationVerdict === "blocked" || !stable || !exitedSuccessfully) latest.delete(kind);
  }
  return latest;
}

function userExplicitlyRequiresFileMutation(prompt: string): boolean {
  return (
    /(?:请(?:在|为|帮我)?(?:创建|新建|写入|生成|保存)(?:一个|一份)?文件|写入到\s*[`"']?[A-Za-z0-9_./\\-]+\.[A-Za-z0-9]+|create\s+(?:a\s+)?(?:new\s+)?file\s+[`"']?[A-Za-z0-9_./\\-]+)/i.test(
      prompt
    ) && !/(?:不要|禁止|无需|不用)(?:创建|写入|修改)/.test(prompt)
  );
}

/**
 * Audits model completion prose against actual tool execution evidence and workspace filesystem.
 */
export function auditClaimsAgainstEvidence(
  input: Pick<
    ResultEvaluationInput,
    "userPrompt" | "finalText" | "workspaceDir" | "toolExecutions" | "latestVerificationVerdict"
  >
): ClaimAuditFinding[] {
  const findings: ClaimAuditFinding[] = [];
  const { userPrompt, finalText, workspaceDir, toolExecutions, latestVerificationVerdict } = input;

  const successfulMutations = toolExecutions.filter(
    (item) =>
      !item.failed &&
      (MUTATION_TOOLS.has(item.tool) || item.mutation === "created" || item.mutation === "updated")
  );
  const claimedPaths = extractClaimedFilePaths(finalText);
  const hasMutationClaim = hasProseMutationClaim(finalText) || claimedPaths.length > 0;
  const requestedPaths = extractPromptTargetFilePaths(userPrompt);
  if (hasMutationClaim || userExplicitlyRequiresFileMutation(userPrompt)) {
    const canonical = (target: string) => {
      const absolute = path.resolve(workspaceDir || ".", target.replace(/\\\\/g, "/"));
      return process.platform === "win32" ? absolute.toLowerCase() : absolute;
    };
    const actualPaths = new Set(successfulMutations.flatMap(item =>
      [...(item.changedPaths ?? []), ...(item.targetPath ? [item.targetPath] : [])]
        .filter(target => !target.startsWith("<")).map(canonical)
    ));
    const targets = new Set([...claimedPaths, ...requestedPaths]);
    const missing = [...targets].find(target => !actualPaths.has(canonical(target)));
    if (missing || (targets.size === 0 && actualPaths.size === 0 && !successfulMutations.some(item => MUTATION_TOOLS.has(item.tool)))) {
      findings.push({
        kind: "unbacked_file_mutation_claim",
        claim: missing ?? "file_mutation",
        detail: "本轮没有对应目标文件的成功写入或实际变更记录。",
      });
    }
  }

  // 2. Check target files on disk when workspaceDir is known
  // Always verify claimedPaths on disk (even if bash ran or no write tool ran),
  // plus user-prompt required file paths when the model claims mutation completion.
  if (workspaceDir) {
    const mutatedTargets = new Set<string>();
    for (const item of successfulMutations) {
      if (item.targetPath && !item.targetPath.startsWith("<")) mutatedTargets.add(item.targetPath);
    }
    for (const p of claimedPaths) {
      mutatedTargets.add(p);
    }
    if (
      userExplicitlyRequiresFileMutation(userPrompt) &&
      hasProseMutationClaim(finalText) &&
      !hasHonestPartialOrBlockedReport(finalText)
    ) {
      for (const p of extractPromptTargetFilePaths(userPrompt)) {
        mutatedTargets.add(p);
      }
    }
    const seenAbsPaths = new Set<string>();
    const resolvedWorkspace = path.resolve(workspaceDir);
    for (const relOrAbs of mutatedTargets) {
      const normalizedRef = relOrAbs.replace(/\\/g, "/");
      const absPath = path.isAbsolute(normalizedRef)
        ? path.normalize(normalizedRef)
        : path.resolve(resolvedWorkspace, normalizedRef);
      const canonicalKey = process.platform === "win32" ? absPath.toLowerCase() : absPath;
      if (seenAbsPaths.has(canonicalKey)) {
        continue;
      }
      seenAbsPaths.add(canonicalKey);
      // Only check files inside workspaceDir
      const relToWorkspace = path.relative(resolvedWorkspace, absPath);
      if (relToWorkspace.startsWith("..") || path.isAbsolute(relToWorkspace)) {
        continue;
      }
      if (!existsSync(absPath)) {
        findings.push({
          kind: "missing_target_file_on_disk",
          claim: relOrAbs,
          detail: `目标文件不存在于工作区磁盘: ${relToWorkspace}`,
        });
      } else {
        try {
          const stat = statSync(absPath);
          if (stat.isFile() && stat.size === 0 && !/空文件|empty\s+file/i.test(userPrompt)) {
            findings.push({
              kind: "empty_target_file_on_disk",
              claim: relOrAbs,
              detail: `目标文件存在但内容为空 (0 bytes): ${relToWorkspace}`,
            });
          } else if (stat.isFile() && stat.size > 0 && absPath.toLowerCase().endsWith(".json")) {
            try {
              JSON.parse(readFileSync(absPath, "utf-8"));
            } catch (parseErr) {
              findings.push({
                kind: "invalid_file_format_on_disk",
                claim: relOrAbs,
                detail: `目标 JSON 文件格式非法 (${relToWorkspace}): ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
              });
            }
          }
        } catch {
          // ignore stat errors
        }
      }
    }
  }

  // 3. A generic verifier/build/syntax pass does not substantiate a test-pass claim.
  const verifiedKinds = freshVerificationEvidence(toolExecutions);
  for (const kind of claimedVerificationKinds(finalText)) {
    if (!verifiedKinds.has(kind) || latestVerificationVerdict === "fail" || latestVerificationVerdict === "blocked") {
      findings.push({
        kind: "unbacked_verification_claim",
        claim: kind,
        detail: `模型宣称 ${kind} 检查通过，但没有对应的最新成功命令和退出状态证据。`,
      });
    }
  }

  // 4. Check if the very last tool execution failed and was never followed by a successful recovery
  if (toolExecutions.length > 0) {
    const lastTool = toolExecutions[toolExecutions.length - 1]!;
    const allFailed = toolExecutions.every((t) => t.failed && !t.blocked);
    const diagnosticRequest = /(?:\bdiagnos(?:e|is|tic|tics)\b|\btroubleshoot\b|诊断|排查)/i.test(userPrompt);
    const observationOnly = diagnosticRequest && !/(?:修复|修改|重构|创建|实现|\b(?:fix|repair|change|create|implement)\b)/i.test(userPrompt)
      && requiredVerificationKinds(userPrompt).length === 0
      && !toolExecutions.some(item => item.mutation || MUTATION_TOOLS.has(item.tool) || item.isVerification || item.tool === "verify");
    const lastMutation = [...toolExecutions].reverse().find(item => item.mutation || MUTATION_TOOLS.has(item.tool));
    const unresolved = lastMutation?.failed && !lastMutation.blocked ? lastMutation : allFailed && !observationOnly ? lastTool : undefined;
    if (unresolved) {
      findings.push({
        kind: "unresolved_tool_failure",
        claim: unresolved.tool,
        detail: `工具 ${unresolved.tool} 执行失败，尚无对应的成功恢复记录。`,
      });
    }
  }

  return findings;
}

export function evaluateTaskResult(input: ResultEvaluationInput): ResultEvaluationReport {
  if (input.enforce === false) {
    return {
      completionStatus: "unknown",
      domain: "general_qa",
      verified: false,
      allowFinish: true,
      summary: "结果评估已按调用方设置关闭。",
      evidence: [],
      unmetCriteria: [],
      claimAuditFindings: [],
      prematureStop: null,
    };
  }
  const toolsUsed = input.toolExecutions.map((t) => t.tool);
  const domain = classifyTaskDomain(input.userPrompt, toolsUsed);
  const evidence: string[] = [];
  const unmetCriteria: string[] = [];

  // 1. Collect positive execution evidence
  const successfulTools = input.toolExecutions.filter((t) => !t.failed);
  const failedTools = input.toolExecutions.filter((t) => t.failed && !t.blocked);
  const verificationEvidence = freshVerificationEvidence(input.toolExecutions);
  for (const item of successfulTools) {
    if (item.mutation && item.targetPath) {
      evidence.push(`file_${item.mutation}:${item.targetPath}`);
    } else if (!item.isVerification && item.tool !== "verify") {
      evidence.push(`tool_ok:${item.tool}${item.targetPath ? `(${item.targetPath})` : ""}`);
    }
  }
  if (input.latestVerificationVerdict !== "fail" && input.latestVerificationVerdict !== "blocked") {
    for (const [kind, item] of verificationEvidence) evidence.push(`verification_pass:${kind}:${item.command ?? item.tool}`);
  }
  const requiredChecks = requiredVerificationKinds(input.userPrompt);
  for (const kind of requiredChecks) {
    if (!verificationEvidence.has(kind) || input.latestVerificationVerdict === "fail" || input.latestVerificationVerdict === "blocked") unmetCriteria.push(`必选验证尚未完成: ${kind}`);
  }

  // 2. Check OutcomeContract if provided
  if (input.outcomeContract && input.evidenceRecords) {
    const contractEval = evaluateOutcomeContract(input.outcomeContract, input.evidenceRecords);
    if (contractEval.status === "blocked") {
      unmetCriteria.push(`结果契约阻塞: ${contractEval.reason}`);
    } else if (contractEval.status === "active") {
      for (const m of contractEval.missing) {
        unmetCriteria.push(`缺失契约交付证据: ${m}`);
      }
    } else if (contractEval.status === "achieved") {
      evidence.push(`contract_achieved:${input.outcomeContract.objective}`);
    }
  }

  // 3. Check StructuredTaskPlan completion if active
  let planSummary = input.activePlan ? summarizeTaskPlan(input.activePlan) : null;
  if (planSummary && planSummary.totalSteps > 0 && !planSummary.isComplete) {
    unmetCriteria.push(
      `任务计划尚有 ${planSummary.unmetStepIds.length} 个未完成步骤 (${planSummary.unmetStepIds.slice(0, 5).join(", ")})`
    );
  } else if (planSummary && planSummary.isComplete) {
    evidence.push(`plan_completed:${planSummary.completedSteps}/${planSummary.totalSteps}`);
  }

  // 4. Check Todo completion state if active
  if (input.todoState && input.todoState.total > 0) {
    const unfinishedCount = input.todoState.pending + input.todoState.inProgress;
    if (unfinishedCount > 0) {
      unmetCriteria.push(
        `待办列表尚有 ${unfinishedCount} 项未完成 (${input.todoState.pendingTitles.slice(0, 3).join(", ")})`
      );
    } else {
      evidence.push(`todos_completed:${input.todoState.completed}/${input.todoState.total}`);
    }
  }

  // 5. Check active unverified mutation
  if (input.activeMutationId && input.latestVerificationVerdict !== "pass") {
    if (input.latestVerificationVerdict === "fail") {
      unmetCriteria.push(`代码/文件变更 (${input.activeMutationId}) 的验证未通过`);
    } else if (input.requireDeterministicVerification) {
      unmetCriteria.push(`代码/文件变更 (${input.activeMutationId}) 尚未完成确定性验证`);
    }
  }

  // 6. Claim-vs-Evidence audit
  const claimAuditFindings = auditClaimsAgainstEvidence(input);
  for (const finding of claimAuditFindings) {
    unmetCriteria.push(finding.detail);
  }

  // 7. Premature stop / deflection detection
  const prematureStop = detectPrematureStopDetailed(input.finalText);
  if (prematureStop) {
    unmetCriteria.push(`检测到早停或甩锅话术 (${prematureStop.pattern}: "${prematureStop.matchedText}")`);
  }

  // 8. Determine 6-way TaskCompletionStatus
  let completionStatus: TaskCompletionStatus;
  const honestPartial = hasHonestPartialOrBlockedReport(input.finalText);
  if (honestPartial && unmetCriteria.length === 0) unmetCriteria.push("模型报告仍有未完成或阻塞步骤");

  if (
    input.latestVerificationVerdict === "fail" ||
    claimAuditFindings.some((f) => f.kind === "unresolved_tool_failure")
  ) {
    completionStatus =
      successfulTools.length > 0 &&
      honestPartial &&
      (planSummary?.isPartiallyComplete || (input.todoState?.completed ?? 0) > 0)
        ? "partially_completed"
        : "failed";
  } else if (
    claimAuditFindings.some(
      (f) =>
        f.kind === "unbacked_file_mutation_claim" ||
        f.kind === "missing_target_file_on_disk" ||
        f.kind === "empty_target_file_on_disk" ||
        f.kind === "invalid_file_format_on_disk" ||
        f.kind === "unbacked_verification_claim"
    ) ||
    prematureStop !== null
  ) {
    // False claims or premature stop deflections are never rewarded as partially_completed
    completionStatus = "incomplete";
  } else if (unmetCriteria.length > 0) {
    const hasVerifiedSubtaskProgress =
      Boolean(planSummary?.isPartiallyComplete) ||
      (input.todoState?.completed ?? 0) > 0 ||
      (successfulTools.length > 0 && honestPartial);
    completionStatus =
      hasVerifiedSubtaskProgress && honestPartial ? "partially_completed" : "incomplete";
  } else if (!input.finalText.trim() && successfulTools.length === 0 && failedTools.length === 0) {
    completionStatus = "unknown";
  } else {
    // No unmet criteria! Distinguish completed_verified vs completed_unverified
    const hasDeterministicVerification =
      evidence.some((e) => e.startsWith("verification_pass:") || e.startsWith("contract_achieved:"));

    if (hasDeterministicVerification) {
      completionStatus = "completed_verified";
    } else if (
      domain === "file_operation" &&
      evidence.some((e) => e.startsWith("file_created:") || e.startsWith("file_updated:"))
    ) {
      completionStatus = "completed_verified";
    } else if (
      (domain === "information_retrieval" || domain === "data_processing") &&
      successfulTools.length > 0 &&
      input.finalText.trim().length > 0
    ) {
      completionStatus = "completed_verified";
    } else if (
      domain === "code_development" &&
      (input.activeMutationId ||
        evidence.some((e) => e.startsWith("file_created:") || e.startsWith("file_updated:")))
    ) {
      completionStatus = "completed_unverified";
    } else if (successfulTools.length > 0) {
      completionStatus = "completed_unverified";
    } else {
      // Pure conversational / general QA turn without tool calls
      completionStatus = "completed_unverified";
    }
  }

  const verified = completionStatus === "completed_verified";
  const allowFinish =
    completionStatus === "completed_verified" || completionStatus === "completed_unverified";

  const summary = allowFinish
    ? `结果判定: ${completionStatus} (证据数=${evidence.length})`
    : `结果判定未通过 (${completionStatus}): ${unmetCriteria.join("；")}`;

  let remediationPrompt: string | undefined;
  if (!allowFinish) {
    remediationPrompt = [
      `<verification_audit status="${completionStatus}">`,
      "【收尾自检未通过 — 禁止提前宣布完成】",
      `当前状态: ${completionStatus}`,
      "未满足的完成条件：",
      ...unmetCriteria.map((item, idx) => `${idx + 1}. ${item}`),
      "",
      "请立即采取行动：",
      "- 若存在未完成的计划步骤或待办项，请继续调用工具执行并更新其状态；",
      "- 若声称创建/修改了文件或运行了测试但尚未实际调用工具，请立即调用真实工具完成操作与验证；",
      "- 若确实遇到无法克服的外部阻塞，请明确说明已完成部分、未完成部分及具体阻塞原因，不要伪装成全部完成。",
      "</verification_audit>",
    ].join("\n");
  }

  return {
    completionStatus,
    domain,
    verified,
    allowFinish,
    summary,
    evidence,
    unmetCriteria,
    claimAuditFindings,
    prematureStop,
    ...(remediationPrompt ? { remediationPrompt } : {}),
  };
}

export const evaluatePreFinalSelfCheck = evaluateTaskResult;

export type CustomDomainVerifier = (
  input: ResultEvaluationInput,
  baseReport: ResultEvaluationReport
) => ResultEvaluationReport;

export class ResultEvaluator {
  private readonly customVerifiers = new Map<TaskDomainKind, CustomDomainVerifier[]>();

  registerVerifier(domain: TaskDomainKind, verifier: CustomDomainVerifier): void {
    const list = this.customVerifiers.get(domain) ?? [];
    list.push(verifier);
    this.customVerifiers.set(domain, list);
  }

  evaluate(input: ResultEvaluationInput): ResultEvaluationReport {
    let report = evaluateTaskResult(input);
    const domainVerifiers = this.customVerifiers.get(report.domain) ?? [];
    for (const verifier of domainVerifiers) {
      report = verifier(input, report);
    }
    return report;
  }

  evaluatePreFinalSelfCheck(input: ResultEvaluationInput): ResultEvaluationReport {
    return this.evaluate(input);
  }
}
