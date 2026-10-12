// ============================================================
// 工具编排（从 AgentLoop 抽出）
// agent-runtime：解析参数、重复限制、pipeline 执行、结果卫生
// ============================================================

import { dispatch } from "../tools/index.js";
import type { ToolDispatcher } from "../tools/index.js";
import type { ToolPipeline } from "../pipeline/hooks.js";
import { checkToolConsistency } from "../pipeline/consistency-checker.js";
import { ApprovalGate, ApprovalRequiredError } from "../guard/approval.js";
import { applyContentFilter } from "../guard/content-filter.js";
import { appendGuardAudit } from "../guard.js";
import type { GuardConfig } from "../config.js";
import type { Channel } from "../channels/types.js";
import type { KnowledgeAgentAdapter } from "../knowledge-agent.js";
import type { MemoryStore } from "../memory.js";
import type { WorkflowRuntime } from "../workflow-runtime.js";
import type { ExecutionEventBus } from "../execution/event-bus.js";
import {
  prepareToolResultContent,
  resolveToolResultMaxChars,
} from "../context-tool-hygiene.js";
import { maybeAutoCommitAfterWrite } from "../git/auto-commit.js";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import {
  classifyToolProgressKind,
  normalizeEvidenceOutput,
  normalizeFailureFingerprint,
  type ToolExecutionObservation,
} from "./run-efficiency.js";
import type {
  Message,
  RawToolCall,
  ToolCall,
  ToolDefinition,
  ToolResult,
} from "../types.js";
import type { UsageLedger, UsageLedgerSnapshot } from "../usage-ledger.js";
import { createHash } from "node:crypto";
import { classifyToolInvocation } from "../harness/tool-capability.js";
import type { RuntimeToolCallRecord } from "../runtime/types.js";
import { ContentAddressedArtifactStore } from "../harness/artifact-store.js";
import { getRuntimeRootsFromEnv, resolveToolPath } from "../runtime-paths.js";
import { assertOwnedMutationPath } from "../agents/ownership.js";
import { authorizeActionIntent, deriveUserActionIntent } from "../harness/action-intent.js";
import { checkFileSyntax } from "../repo-index/syntax-check.js";
import { getBackgroundTaskRegistry } from "../runtime/background-tasks.js";
import { resolveProjectProfileIdentity } from "../runtime/project-profile.js";
import { runWithRuntimeExecutionIdentity } from "../runtime-paths.js";
import { isUntrackedDiagnosticArtifact } from "../diagnostic-artifact.js";

const execFileAsync = promisify(execFile);

interface WorkspaceMutationSnapshot {
  available: boolean;
  head?: string;
  fingerprint?: string;
  files: Map<string, { hash: string; created: boolean }>;
}

const backgroundMutationSnapshots = new Map<string, WorkspaceMutationSnapshot>();

async function captureWorkspaceMutationSnapshot(workspaceDir: string): Promise<WorkspaceMutationSnapshot> {
  try {
    const [result, headResult] = await Promise.all([
      execFileAsync(
        "git",
        ["-c", "core.quotepath=false", "status", "--porcelain=v1", "-z", "--untracked-files=all"],
        { cwd: workspaceDir, windowsHide: true, timeout: 10_000, maxBuffer: 4 * 1024 * 1024 },
      ),
      execFileAsync("git", ["rev-parse", "HEAD"], {
        cwd: workspaceDir,
        windowsHide: true,
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
      }),
    ]);
    const files = new Map<string, { hash: string; created: boolean }>();
    for (const entry of result.stdout.split("\0").filter(Boolean)) {
      const status = entry.slice(0, 2);
      const relative = entry.slice(3).replace(/\\/g, "/");
      if (!relative) continue;
      const target = path.resolve(workspaceDir, relative);
      let hash = "deleted";
      try {
        const stat = await fs.stat(target);
        hash = stat.size <= 1024 * 1024
          ? createHash("sha256").update(await fs.readFile(target)).digest("hex")
          : `large:${stat.size}:${stat.mtimeMs}`;
      } catch { /* deleted */ }
      files.set(relative, { hash, created: status === "??" });
    }
    const identity = await resolveProjectProfileIdentity(workspaceDir);
    return { available: true, head: headResult.stdout.trim(), fingerprint: `${identity.revision}:${identity.dirtyFingerprint}`, files };
  } catch {
    return { available: false, files: new Map() };
  }
}

function serializeWorkspaceSnapshot(snapshot: WorkspaceMutationSnapshot) {
  return { available: snapshot.available, head: snapshot.head, fingerprint: snapshot.fingerprint, files: Object.fromEntries(snapshot.files) };
}

export function resolveToolEventTarget(call: ToolCall, workspaceDir: string): string | undefined {
  const raw = typeof call.arguments.path === "string"
    ? call.arguments.path
    : typeof call.arguments.file === "string" ? call.arguments.file : "";
  if (!raw) return undefined;
  const runtimeRoots = getRuntimeRootsFromEnv();
  const absolute = resolveToolPath(raw, { ...runtimeRoots, workspaceDir }, "workspace");
  const relative = path.relative(workspaceDir, absolute).replace(/\\/g, "/");
  if (!relative || relative === ".") return ".";
  return relative === ".." || relative.startsWith("../") ? "<outside-workspace>" : relative;
}

function deserializeWorkspaceSnapshot(snapshot: { available: boolean; head?: string; fingerprint?: string; files: Record<string, { hash: string; created: boolean }> }): WorkspaceMutationSnapshot {
  return { available: snapshot.available, head: snapshot.head, fingerprint: snapshot.fingerprint, files: new Map(Object.entries(snapshot.files ?? {})) };
}

function diffWorkspaceSnapshots(before: WorkspaceMutationSnapshot, after: WorkspaceMutationSnapshot): {
  changedPaths: string[];
  mutation?: "created" | "updated";
} {
  if (!before.available || !after.available) return { changedPaths: [] };
  const changedPaths = [...new Set([...before.files.keys(), ...after.files.keys()])]
    .filter((relative) => before.files.get(relative)?.hash !== after.files.get(relative)?.hash)
    .sort();
  if (before.head !== after.head) changedPaths.unshift("<repository-head>");
  if (changedPaths.length === 0) return { changedPaths };
  return {
    changedPaths,
    mutation: changedPaths.some((relative) => after.files.get(relative)?.created) ? "created" : "updated",
  };
}

async function excludeDiagnosticMutationPaths(
  mutation: { changedPaths: string[]; mutation?: "created" | "updated" },
  workspaceDir: string,
  after: WorkspaceMutationSnapshot,
): Promise<{ changedPaths: string[]; mutation?: "created" | "updated" }> {
  const changedPaths: string[] = [];
  for (const relative of mutation.changedPaths) {
    if (relative.startsWith("<")) {
      changedPaths.push(relative);
      continue;
    }
    if (!after.files.get(relative)?.created) {
      changedPaths.push(relative);
      continue;
    }
    if (relative.includes("/") || !/\.(?:py|js|mjs|cjs|ts|ps1|sh)$/i.test(relative)) {
      changedPaths.push(relative);
      continue;
    }
    let content = "";
    try {
      const target = path.resolve(workspaceDir, relative);
      const stat = await fs.lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024) {
        changedPaths.push(relative);
        continue;
      }
      content = await fs.readFile(target, "utf8");
    } catch {
      changedPaths.push(relative);
      continue;
    }
    if (!(await isUntrackedDiagnosticArtifact(relative, content, workspaceDir))) changedPaths.push(relative);
  }
  if (changedPaths.length === 0) return { changedPaths };
  return {
    changedPaths,
    mutation: changedPaths.some((relative) => after.files.get(relative)?.created) ? "created" : "updated",
  };
}

export type ParseToolArgsResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string };

export interface PreparedToolCall {
  call: ToolCall;
  immediateResult?: ToolResult;
  loopDetected?: {
    signature: string;
    count: number;
    limit: number;
  };
}

export function repairToolArguments(source: string, attempt: number): string {
  let out = source.trim();
  if (attempt === 0) {
    const fenced = out.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fenced) {
      out = fenced[1].trim();
    }
    return out;
  }
  if (attempt === 1) {
    return out.replace(/,\s*([}\]])/g, "$1");
  }
  if (attempt === 2) {
    return out
      .replace(/[“”]/g, "\"")
      .replace(/[‘’]/g, "'")
      .replace(/([{,]\s*)'([^']+?)'\s*:/g, '$1"$2":')
      .replace(/:\s*'([^']*?)'(\s*[,}])/g, ': "$1"$2');
  }
  return out;
}

export function parseToolArguments(
  raw: string,
  parseRetries = 0
): ParseToolArgsResult {
  const retries = Math.max(0, parseRetries);
  let candidate = String(raw ?? "");
  let lastError = "invalid arguments";

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        lastError = "arguments must be a JSON object";
      } else {
        return { ok: true, value: parsed as Record<string, unknown> };
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (attempt < retries) {
      candidate = repairToolArguments(candidate, attempt);
    }
  }

  return {
    ok: false,
    error: `failed after ${retries + 1} attempt(s): ${lastError}`,
  };
}

export function stableStringify(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) {
      return input.map((item) => normalize(item));
    }
    if (input && typeof input === "object") {
      const entries = Object.entries(input as Record<string, unknown>).sort(([a], [b]) =>
        a.localeCompare(b)
      );
      const obj: Record<string, unknown> = {};
      for (const [k, v] of entries) {
        obj[k] = normalize(v);
      }
      return obj;
    }
    return input;
  };

  try {
    return JSON.stringify(normalize(value));
  } catch {
    return "[unstringifiable]";
  }
}

export function fingerprintToolAction(call: Pick<ToolCall, "name" | "arguments">): string {
  const argumentsHash = createHash("sha256").update(stableStringify(call.arguments)).digest("hex");
  return `${call.name}:${argumentsHash}`;
}

export function buildToolSignature(name: string, args: Record<string, unknown>): string {
  return `${name}:${stableStringify(args)}`;
}

/**
 * Parse raw tool calls, apply argument repair retries, and enforce per-signature
 * repeat limits within the current run.
 */
export function prepareToolCalls(
  toolCalls: RawToolCall[],
  options: {
    parseRetries?: number;
    toolRepeatLimit?: number;
    signatureCounts?: Map<string, number>;
  } = {}
): PreparedToolCall[] {
  const parseRetries = options.parseRetries ?? 0;
  const toolRepeatLimit = Math.max(1, options.toolRepeatLimit ?? 6);
  const signatureCounts = options.signatureCounts ?? new Map<string, number>();
  const prepared: PreparedToolCall[] = [];

  for (const tc of toolCalls) {
    const parseResult = parseToolArguments(tc.function.arguments, parseRetries);
    if (!parseResult.ok) {
      prepared.push({
        call: {
          id: tc.id,
          name: tc.function.name,
          arguments: {},
        },
        immediateResult: {
          tool_call_id: tc.id,
          output: `Error: [TOOL_INVALID_ARGUMENTS] ${parseResult.error}`,
          is_error: true,
          error: {
            code: "TOOL_INVALID_ARGUMENTS",
            message: parseResult.error,
            category: "runtime",
          },
        },
      });
      continue;
    }

    const call: ToolCall = {
      id: tc.id,
      name: tc.function.name,
      arguments: parseResult.value,
    };
    const signature = buildToolSignature(call.name, call.arguments);
    const repeatCount = (signatureCounts.get(signature) ?? 0) + 1;
    signatureCounts.set(signature, repeatCount);
    if (repeatCount > toolRepeatLimit) {
      prepared.push({
        call,
        loopDetected: { signature, count: repeatCount, limit: toolRepeatLimit },
        immediateResult: {
          tool_call_id: tc.id,
          output:
            `Error: [TOOL_REPEAT_LIMIT_EXCEEDED] ` +
            `tool '${call.name}' exceeded repeat limit (${toolRepeatLimit})`,
          is_error: true,
          error: {
            code: "TOOL_REPEAT_LIMIT_EXCEEDED",
            message: `tool '${call.name}' exceeded repeat limit (${toolRepeatLimit})`,
            category: "guard",
          },
        },
      });
      continue;
    }
    prepared.push({ call });
  }

  return prepared;
}

export type ReflectionDecision = "proceed" | "ask" | "block" | "warn";

export interface ToolOrchestratorDeps {
  pipeline: ToolPipeline;
  tools: ToolDefinition[];
  guardConfig: GuardConfig;
  channel: Channel | null;
  approvalGate: ApprovalGate;
  knowledgeAdapter: KnowledgeAgentAdapter;
  memoryStore: MemoryStore;
  workspaceDir: string;
  fileStateDir?: string;
  ownedPaths?: string[];
  workflowRuntime: WorkflowRuntime;
  executionEventBus: ExecutionEventBus;
  emit: (event: string, ...args: unknown[]) => void;
  reflectiveThink: (tc: ToolCall) => Promise<{ decision: ReflectionDecision; reason: string }>;
  usageLedger?: UsageLedger;
  dispatchTool?: ToolDispatcher;
  recordRuntimeTool?: (record: RuntimeToolCallRecord) => Promise<void>;
}

export interface ExecuteToolsContext {
  preparedCalls: PreparedToolCall[];
  messages: Message[];
  runId: string;
  attemptId: string;
  sessionId?: string;
  sessionLeaseToken?: string;
}

export interface ExecuteToolsResult {
  turnToolCalls: number;
  turnToolFailures: number;
  observations: ToolExecutionObservation[];
}

/**
 * Execute a prepared tool batch, appending tool messages onto `context.messages`.
 */
export async function executePreparedTools(
  deps: ToolOrchestratorDeps,
  context: ExecuteToolsContext
): Promise<ExecuteToolsResult> {
  const dispatchTool = deps.dispatchTool ?? dispatch;
  let turnToolCalls = 0;
  let turnToolFailures = 0;
  const observations: ToolExecutionObservation[] = [];
  const { preparedCalls, messages, runId, attemptId } = context;

  if (process.env.QLING_FEATURES_WORKFLOW_RUNTIME === "true") {
    await deps.workflowRuntime.setPendingTools(preparedCalls.map((p) => p.call));
  }

  for (const prepared of preparedCalls) {
    const tc = prepared.call;
    const definition = deps.tools.find((tool) => tool.name === tc.name);
    const capability = classifyToolInvocation({
      name: tc.name,
      arguments: tc.arguments,
      ...(definition ? { definition } : {}),
    });
    const actionFingerprint = fingerprintToolAction(tc);
    const argumentsHash = actionFingerprint.slice(actionFingerprint.indexOf(":") + 1);
    const mutationArgs = tc.arguments as { path?: string; file?: string; dry_run?: boolean };
    const mutationTargetRaw =
      tc.name === "write" || tc.name === "patch"
        ? String(mutationArgs.path || mutationArgs.file || "").trim()
        : "";
    const mutationTarget = mutationTargetRaw
      ? path.resolve(deps.workspaceDir || process.cwd(), mutationTargetRaw)
      : "";
    const mutationExistedBefore = mutationTarget ? existsSync(mutationTarget) : false;
    const reliabilityEnabled = process.env.QLING_FEATURES_RELIABILITY_V2 === "true";
    const backgroundWaitId = tc.name === "bg_wait" || tc.name === "bg_kill" || tc.name === "bg_reconcile" ? String(tc.arguments.task_id ?? "").trim() : "";
    const backgroundRegistry = getBackgroundTaskRegistry(deps.fileStateDir);
    const persistedBaseline = backgroundWaitId ? backgroundRegistry.get(backgroundWaitId)?.workspaceBaseline : undefined;
    const bashSnapshotBefore = reliabilityEnabled && (tc.name === "bash" || tc.name === "bg_wait" || tc.name === "bg_kill" || tc.name === "bg_reconcile")
      ? (backgroundWaitId ? backgroundMutationSnapshots.get(backgroundWaitId) : undefined)
        ?? (persistedBaseline ? deserializeWorkspaceSnapshot(persistedBaseline) : backgroundWaitId ? { available: false, files: new Map() } : await captureWorkspaceMutationSnapshot(deps.workspaceDir || process.cwd()))
      : null;
    turnToolCalls++;
    await deps.recordRuntimeTool?.({
      toolCallId: tc.id,
      tool: tc.name,
      argumentsHash,
      sideEffect: capability.sideEffect,
      idempotent: capability.idempotent,
      status: "running",
      startedAt: Date.now(),
    });
    if (process.env.QLING_FEATURES_TOOL_CAPABILITIES === "true") {
      deps.emit("tool_capability", {
        tool: tc.name,
        sideEffect: capability.sideEffect,
        risk: capability.risk,
        permission: capability.permission,
      });
    }
    deps.executionEventBus.startTool({
      runId,
      attemptId,
      toolCallId: tc.id,
      tool: tc.name,
      toolTarget: resolveToolEventTarget(tc, deps.workspaceDir || process.cwd()),
    });
    deps.emit("tool_start", tc.name, tc.arguments);
    deps.knowledgeAdapter.onToolCall(tc);
    let preflightResult = prepared.immediateResult;

    // bg_reconcile is a control-plane acknowledgement for an already unknown
    // process outcome. It is always routed through a fresh approval below and
    // never stored as a reusable grant, so the original task's write intent
    // must not make that acknowledgement unreachable.
    if (!preflightResult && process.env.QLING_FEATURES_TRUST_BOUNDARY === "true" && tc.name !== "bg_reconcile") {
      const lastTrustedUserMessage = [...messages]
        .reverse()
        .find((message) => message.role === "user" && !message.synthetic_reason)?.content ?? "";
      const intent = deriveUserActionIntent({
        userMessage: lastTrustedUserMessage,
        workspaceDir: deps.workspaceDir || process.cwd(),
        sourceEventId: `run:${runId}`,
      });
      const authorization = authorizeActionIntent({
        intent,
        tool: tc.name,
        effect: capability.sideEffect,
        target: mutationTarget || undefined,
      });
      if (!authorization.allowed) {
        preflightResult = {
          tool_call_id: tc.id,
          output: `Error: [ACTION_INTENT_DENIED] ${authorization.reason}`,
          is_error: true,
          error: {
            code: "ACTION_INTENT_DENIED",
            message: authorization.reason,
            category: "permission",
          },
        };
      }
    }

    if (!preflightResult && deps.ownedPaths && deps.ownedPaths.length > 0) {
      if (tc.name === "bash") {
        preflightResult = {
          tool_call_id: tc.id,
          output: "Error: [SUBTASK_OWNERSHIP_DENIED] bash is disabled for owned-path implement subtasks",
          is_error: true,
          error: { code: "SUBTASK_OWNERSHIP_DENIED", message: "bash is disabled under owned_paths", category: "permission" },
        };
      } else if (tc.name === "write" || tc.name === "patch") {
        try {
          const mutation = tc.arguments as { path?: string; file?: string };
          await assertOwnedMutationPath({
            workspaceDir: deps.workspaceDir,
            target: String(mutation.path ?? mutation.file ?? ""),
            ownedPaths: deps.ownedPaths,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          preflightResult = {
            tool_call_id: tc.id,
            output: `Error: [SUBTASK_OWNERSHIP_DENIED] ${message}`,
            is_error: true,
            error: { code: "SUBTASK_OWNERSHIP_DENIED", message, category: "permission" },
          };
        }
      }
    }

    if (!preflightResult && (tc.name === "write" || tc.name === "bash")) {
      const reflection = await deps.reflectiveThink(tc);
      if (reflection.decision === "block") {
        console.error(`🚨 [内省阻断] ${reflection.reason}`);
        preflightResult = {
          tool_call_id: tc.id,
          output: `Error: [REFLECTION_BLOCKED] ${reflection.reason}. This action was deemed too risky.`,
          is_error: true,
          error: {
            code: "REFLECTION_BLOCKED",
            message: reflection.reason,
            category: "guard",
          },
        };
      } else if (reflection.decision === "warn") {
        console.error(`💭 [内省警告] ${reflection.reason}`);
      }
    }

    if (!preflightResult && process.env.QLING_FEATURES_TOOL_SPEC_BOOST === "true") {
      const def = deps.tools.find((t) => t.name === tc.name);
      if (def) {
        const check = checkToolConsistency(tc, def);
        if (!check.ok) {
          const checkError = check.error ?? "tool arguments do not match the specification";
          console.error(`⚠️ [SpecBoost] 检查到幻觉风险: ${tc.name} - ${checkError}`);
          preflightResult = {
            tool_call_id: tc.id,
            output: `Error: [TOOL_SPEC_VIOLATION] ${checkError}. Please correct your arguments based on the schema and examples.`,
            is_error: true,
            error: {
              code: "TOOL_SPEC_VIOLATION",
              message: checkError,
              category: "validation",
            },
          };
        }
        if (check.warnings.length > 0) {
          console.warn(`[SpecBoost] 潜在警告: ${check.warnings.join("; ")}`);
        }
      }
    }

    let result: ToolResult = preflightResult ?? {
      tool_call_id: tc.id,
      output: "",
      is_error: false,
    };

    if (!preflightResult) {
      if (tc.name === "write" || tc.name === "patch") {
        tc.arguments = { ...tc.arguments, __qling_workspace_dir: deps.workspaceDir };
      }
      try {
        result = await runWithRuntimeExecutionIdentity({ sessionId: context.sessionId, runId, leaseToken: context.sessionLeaseToken }, () => deps.pipeline.execute(tc, (t) => dispatchTool(t)));
      } catch (err) {
        if (err instanceof ApprovalRequiredError) {
          if (!deps.channel) {
            result = {
              tool_call_id: tc.id,
              output:
                "[Approval Channel Missing] 需要确认工具 " +
                err.toolName +
                "，但当前运行模式未挂载审批通道（chat 应使用 TuiChannel；run 应使用 Console/Telegram/Slack）。原因: " +
                err.reasons.join("; "),
              is_error: true,
              error: {
                code: "APPROVAL_CHANNEL_MISSING",
                message: "No approval channel configured for ask decision",
                category: "permission",
              },
            };
          } else {
            if (process.env.QLING_FEATURES_WORKFLOW_RUNTIME === "true") {
              await deps.workflowRuntime.awaitApproval();
            }
            const approvalResponse = await deps.approvalGate.requestApproval(
              {
                id: err.toolCallId,
                toolName: err.toolName,
                arguments: tc.arguments as Record<string, unknown>,
                reason: err.reasons.join("; "),
                timestamp: Date.now(),
              },
              deps.channel
            );
            if (approvalResponse.decision === "allow") {
              try {
                if (tc.name !== "bg_reconcile") {
                  const { getPermissionGrantStore } = await import("../guard/permission-grants.js");
                  getPermissionGrantStore().remember(tc.name, {
                    reason: "user approval",
                  });
                }
              } catch {
                // grant 失败不阻断执行
              }
              result = await runWithRuntimeExecutionIdentity({ sessionId: context.sessionId, runId, leaseToken: context.sessionLeaseToken }, () => dispatchTool(tc));
            } else {
              result = {
                tool_call_id: tc.id,
                output: "[Approval Denied] " + err.reasons.join("; "),
                is_error: true,
                error: {
                  code: "APPROVAL_DENIED",
                  message: "User denied tool execution",
                  category: "permission",
                },
              };
            }
          }
        } else {
          result = {
            tool_call_id: tc.id,
            output: (err as Error).message,
            is_error: true,
            error: {
              code: "TOOL_ERROR",
              message: (err as Error).message,
              category: "runtime",
            },
          };
        }
      }
    }
    let directDiagnosticArtifact = result.meta?.diagnosticArtifact === true;
    if (!directDiagnosticArtifact && tc.name === "patch" && mutationTarget && !result.is_error && !mutationArgs.dry_run) {
      let patchedContent = "";
      try { patchedContent = await fs.readFile(mutationTarget, "utf8"); } catch { /* handled as a normal mutation */ }
      directDiagnosticArtifact = await isUntrackedDiagnosticArtifact(
        mutationTarget,
        patchedContent,
        deps.workspaceDir || process.cwd(),
      );
    }
    const workspaceMutationApplied =
      !result.is_error &&
      !directDiagnosticArtifact &&
      Boolean(mutationTarget) &&
      !mutationArgs.dry_run &&
      (tc.name === "write" || tc.name === "patch");
    let mutationSucceeded = workspaceMutationApplied;
    let indirectMutation: { changedPaths: string[]; mutation?: "created" | "updated" } = { changedPaths: [] };
    if (bashSnapshotBefore) {
      const bashSnapshotAfter = await captureWorkspaceMutationSnapshot(deps.workspaceDir || process.cwd());
      indirectMutation = await excludeDiagnosticMutationPaths(
        diffWorkspaceSnapshots(bashSnapshotBefore, bashSnapshotAfter),
        deps.workspaceDir || process.cwd(),
        bashSnapshotAfter,
      );
      if (tc.name === "bg_reconcile" && !result.is_error && indirectMutation.changedPaths.length === 0) {
        // A recovered process cannot prove that it had no side effects merely
        // because the current Git-visible diff matches its launch baseline.
        // Keep a synthetic mutation so completion still requires a fresh,
        // deterministic verifier after the operator acknowledgment.
        indirectMutation = { changedPaths: ["<unknown-background-outcome>"], mutation: "updated" };
      }
      if (
        indirectMutation.changedPaths.length === 0
        && (tc.name === "bg_wait" || capability.sideEffect !== "none")
        && (!bashSnapshotBefore.available || !bashSnapshotAfter.available)
      ) {
        indirectMutation = { changedPaths: ["<workspace-capture-unavailable>"], mutation: "updated" };
      }
    }
    const backgroundTaskId = result.meta?.backgroundTaskId;
    if (tc.name === "bash" && typeof backgroundTaskId === "string" && bashSnapshotBefore) {
      backgroundMutationSnapshots.set(backgroundTaskId, bashSnapshotBefore);
      backgroundRegistry.setWorkspaceBaseline(backgroundTaskId, serializeWorkspaceSnapshot(bashSnapshotBefore));
    }
    const backgroundTaskCompleted = result.meta?.backgroundTaskCompleted;
    if (typeof backgroundTaskCompleted === "string") backgroundMutationSnapshots.delete(backgroundTaskCompleted);
    const backgroundTaskReconciled = result.meta?.backgroundTaskReconciliationPending;
    if (typeof backgroundTaskReconciled === "string") backgroundMutationSnapshots.delete(backgroundTaskReconciled);
    if (mutationSucceeded && process.env.QLING_FEATURES_RELIABILITY_V2 === "true") {
      const syntax = await checkFileSyntax(mutationTarget);
      if (!syntax.ok) {
        result = {
          ...result,
          output: `${result.output}\n\nError: [FAST_SYNTAX_CHECK_FAILED] ${syntax.reason}`,
          is_error: true,
          error: {
            code: "FAST_SYNTAX_CHECK_FAILED",
            message: syntax.reason,
            category: "validation",
          },
        };
        mutationSucceeded = false;
      }
    }

    deps.knowledgeAdapter.onToolResult(result, tc.name);
    const usageSnapshot = result.meta?.usageSnapshot as UsageLedgerSnapshot | undefined;
    if (usageSnapshot) deps.usageLedger?.merge(usageSnapshot);
    if (typeof backgroundTaskId === "string") {
      deps.executionEventBus.emit({
        runId,
        attemptId,
        toolCallId: tc.id,
        tool: tc.name,
        type: "subtask_backgrounded",
        status: "running",
        stage: "subtask",
        recoveryAction: backgroundTaskId,
      });
    }
    const efficiencyRedirect = result.error?.code === "EFFICIENCY_RECOVERY_SCOPE"
      || result.error?.code === "EFFICIENCY_ACTION_BLOCKED";
    deps.executionEventBus.completeTool({
      runId,
      attemptId,
      toolCallId: tc.id,
      tool: tc.name,
      failed: result.is_error,
      policyRedirect: efficiencyRedirect,
    });
    deps.emit("tool_result", tc.name, result.output, result.is_error ?? false);

    if (!result.is_error && (tc.name === "bash" || tc.name === "write" || tc.name === "read")) {
      let lastUserMsg = "";
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "user") {
          lastUserMsg = messages[i].content;
          break;
        }
      }
      const taskId = "task_" + Buffer.from(lastUserMsg.slice(0, 10)).toString("hex");
      deps.memoryStore.link(
        { id: taskId, type: "task", label: lastUserMsg.slice(0, 50) },
        "uses",
        { id: "tool_" + tc.name, type: "tool", label: tc.name }
      );
      const args = tc.arguments as { path?: string; file?: string };
      const targetFile = args.path || args.file || "";
      if (targetFile) {
        deps.memoryStore.link(
          { id: "tool_" + tc.name, type: "tool", label: tc.name },
          tc.name === "read" ? "reads" : "writes",
          {
            id: "file_" + Buffer.from(targetFile).toString("hex"),
            type: "file",
            label: targetFile,
          }
        );
      }
    }

    if (
      !result.is_error &&
      (tc.name === "write" || tc.name === "patch") &&
      result.meta?.diagnosticArtifact !== true &&
      !(tc.arguments as { dry_run?: boolean })?.dry_run
    ) {
      const args = tc.arguments as { path?: string; file?: string };
      const targetFile = String(args.path || args.file || "").trim();
      if (targetFile) {
        try {
          const ac = await maybeAutoCommitAfterWrite({
            workspaceDir: deps.workspaceDir || process.cwd(),
            filePath: targetFile,
            toolName: tc.name,
          });
          if (ac.mode !== "off") {
            result = {
              ...result,
              output: `${result.output}\n\n[${ac.message}]`,
            };
          }
        } catch {
          // auto-commit 失败不影响工具成功语义
        }
      }
    }

    if (deps.guardConfig.enabled && deps.guardConfig.content_filter?.enabled) {
      const cf = applyContentFilter(result.output, {
        pii: deps.guardConfig.content_filter.pii_detection,
        injection: deps.guardConfig.content_filter.injection_detection,
        custom: deps.guardConfig.content_filter.custom_patterns.length > 0,
      });
      if (cf.blocked) {
        await appendGuardAudit(deps.guardConfig, {
          tool: tc.name,
          action: "deny",
          category: "content_filter",
          reason: cf.reason,
        });
        result = {
          ...result,
          output: `[内容过滤] ${cf.reason}: ${(cf.matches ?? []).join(", ")}`,
          is_error: true,
          error: {
            code: "CONTENT_FILTERED",
            message: cf.reason ?? "content filtered",
            category: "guard",
          },
        };
      }
    }

    if (result.is_error && !efficiencyRedirect) turnToolFailures++;
    await deps.recordRuntimeTool?.({
      toolCallId: tc.id,
      tool: tc.name,
      argumentsHash,
      sideEffect: capability.sideEffect,
      idempotent: capability.idempotent,
      status: result.is_error ? "failed" : "succeeded",
      completedAt: Date.now(),
    });
    const progressKind = classifyToolProgressKind(tc.name, tc.arguments);
    const verificationMeta = tc.name === "verify" ? result.meta : undefined;
    const observationMutation = workspaceMutationApplied ? (mutationExistedBefore ? "updated" : "created") : indirectMutation.mutation;
    let observationWorkspaceFingerprint: string | undefined;
    if (observationMutation) {
      if (bashSnapshotBefore) {
        observationWorkspaceFingerprint = (await captureWorkspaceMutationSnapshot(deps.workspaceDir || process.cwd())).fingerprint;
      }
      if (!observationWorkspaceFingerprint) {
        const identity = await resolveProjectProfileIdentity(deps.workspaceDir || process.cwd());
        observationWorkspaceFingerprint = `${identity.revision}:${identity.dirtyFingerprint}`;
      }
    }
    observations.push({
      tool: tc.name,
      failed: Boolean(result.is_error) && !efficiencyRedirect,
      ...(efficiencyRedirect ? { redirected: true } : {}),
      actionFingerprint,
      ...(progressKind
        ? {
            progressKind,
            evidenceFingerprint: typeof verificationMeta?.normalizedFingerprint === "string"
              ? verificationMeta.normalizedFingerprint
              : `${tc.name}:${createHash("sha256").update(normalizeEvidenceOutput(result.output)).digest("hex")}`,
            ...(typeof tc.arguments.root_cause_id === "string" && tc.arguments.root_cause_id.trim()
              ? { rootCauseId: tc.arguments.root_cause_id.trim() }
              : {}),
            ...(progressKind === "verification_delta"
              ? {
                  verifierId: typeof verificationMeta?.commandId === "string" ? verificationMeta.commandId : actionFingerprint,
                  mutationId: typeof verificationMeta?.mutationId === "string" ? verificationMeta.mutationId : undefined,
                  verificationBaseFingerprint: typeof verificationMeta?.verificationBaseFingerprint === "string" ? verificationMeta.verificationBaseFingerprint : undefined,
                  workspaceFingerprint: typeof verificationMeta?.workspaceFingerprint === "string" ? verificationMeta.workspaceFingerprint : undefined,
                  verificationVerdict: verificationMeta?.verdict === "pass" ? "pass" as const : "fail" as const,
                }
              : {}),
          }
        : {}),
      failureFingerprint: result.is_error && !efficiencyRedirect
        ? normalizeFailureFingerprint({
            tool: tc.name,
            code: result.error?.code,
            category: result.error?.category,
            message: [result.error?.message, result.output].filter(Boolean).join(" | "),
          })
        : undefined,
      ...(result.is_error && !efficiencyRedirect && result.error?.code
        ? { failureCode: result.error.code }
        : {}),
      targetPath: workspaceMutationApplied
        ? mutationTarget
        : indirectMutation.changedPaths[0],
      changedPaths: workspaceMutationApplied
        ? [path.relative(deps.workspaceDir || process.cwd(), mutationTarget).replace(/\\/g, "/")]
        : indirectMutation.changedPaths.length > 0 ? indirectMutation.changedPaths : undefined,
      mutation: workspaceMutationApplied
        ? (mutationExistedBefore ? "updated" : "created")
        : indirectMutation.mutation,
      mutationId: workspaceMutationApplied || indirectMutation.mutation ? actionFingerprint : undefined,
      ...(observationWorkspaceFingerprint ? { workspaceFingerprint: observationWorkspaceFingerprint } : {}),
      ...(typeof backgroundTaskId === "string" ? { backgroundTaskStarted: backgroundTaskId } : {}),
      ...(typeof backgroundTaskCompleted === "string" ? { backgroundTaskCompleted } : {}),
      ...(typeof backgroundTaskReconciled === "string" ? { backgroundTaskReconciled } : {}),
    });

    const preview = result.output.split("\n")[0].slice(0, 80);
    const icon = result.is_error ? "❌" : "✅";
    console.error(icon + " " + tc.name + ": " + preview + (result.output.length > 80 ? "..." : ""));

    if (process.env.QLING_FEATURES_WORKFLOW_RUNTIME === "true") {
      await deps.workflowRuntime.addToolResult(result);
    }

    const rawToolContent = JSON.stringify(result);
    let artifactNote = "";
    const maxToolChars = resolveToolResultMaxChars();
    if (
      (process.env.QLING_FEATURES_ARTIFACT_STORE === "true" ||
        process.env.QLING_FEATURES_RELIABILITY_V2 === "true") &&
      maxToolChars > 0 &&
      rawToolContent.length > maxToolChars
    ) {
      const roots = getRuntimeRootsFromEnv();
      try {
        const artifact = await new ContentAddressedArtifactStore(roots.fileStateDir).put(
          rawToolContent,
          "application/json"
        );
        artifactNote = `\n[artifact ref=artifact://sha256/${artifact.hash} bytes=${artifact.bytes}]`;
      } catch {
        artifactNote = "\n[artifact unavailable: local offload failed]";
      }
    }
    const hygienicContent = prepareToolResultContent(rawToolContent, {
      maxChars: maxToolChars,
    });
    messages.push({
      role: "tool",
      content: `${hygienicContent}${artifactNote}`,
      tool_call_id: tc.id,
    });
  }

  return { turnToolCalls, turnToolFailures, observations };
}
