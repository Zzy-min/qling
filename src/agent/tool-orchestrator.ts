// ============================================================
// 工具编排（从 AgentLoop 抽出）
// agent-runtime：解析参数、重复限制、pipeline 执行、结果卫生
// ============================================================

import { dispatch } from "../tools/index.js";
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
import type {
  Message,
  RawToolCall,
  ToolCall,
  ToolDefinition,
  ToolResult,
} from "../types.js";
import type { UsageLedger, UsageLedgerSnapshot } from "../usage-ledger.js";

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
  workflowRuntime: WorkflowRuntime;
  executionEventBus: ExecutionEventBus;
  emit: (event: string, ...args: unknown[]) => void;
  reflectiveThink: (tc: ToolCall) => Promise<{ decision: ReflectionDecision; reason: string }>;
  usageLedger?: UsageLedger;
}

export interface ExecuteToolsContext {
  preparedCalls: PreparedToolCall[];
  messages: Message[];
  runId: string;
  attemptId: string;
}

export interface ExecuteToolsResult {
  turnToolCalls: number;
  turnToolFailures: number;
}

/**
 * Execute a prepared tool batch, appending tool messages onto `context.messages`.
 */
export async function executePreparedTools(
  deps: ToolOrchestratorDeps,
  context: ExecuteToolsContext
): Promise<ExecuteToolsResult> {
  let turnToolCalls = 0;
  let turnToolFailures = 0;
  const { preparedCalls, messages, runId, attemptId } = context;

  if (process.env.QLING_FEATURES_WORKFLOW_RUNTIME === "true") {
    await deps.workflowRuntime.setPendingTools(preparedCalls.map((p) => p.call));
  }

  for (const prepared of preparedCalls) {
    const tc = prepared.call;
    turnToolCalls++;

    if (tc.name === "write" || tc.name === "bash") {
      const reflection = await deps.reflectiveThink(tc);
      if (reflection.decision === "block") {
        console.error(`🚨 [内省阻断] ${reflection.reason}`);
        messages.push({
          role: "tool",
          content: JSON.stringify({
            tool_call_id: tc.id,
            output: `Error: [REFLECTION_BLOCKED] ${reflection.reason}. This action was deemed too risky.`,
            is_error: true,
          }),
          tool_call_id: tc.id,
        });
        turnToolFailures++;
        continue;
      } else if (reflection.decision === "warn") {
        console.error(`💭 [内省警告] ${reflection.reason}`);
      }
    }

    if (process.env.QLING_FEATURES_TOOL_SPEC_BOOST === "true") {
      const def = deps.tools.find((t) => t.name === tc.name);
      if (def) {
        const check = checkToolConsistency(tc, def);
        if (!check.ok) {
          console.error(`⚠️ [SpecBoost] 检查到幻觉风险: ${tc.name} - ${check.error}`);
          messages.push({
            role: "tool",
            content: JSON.stringify({
              tool_call_id: tc.id,
              output: `Error: [TOOL_SPEC_VIOLATION] ${check.error}. Please correct your arguments based on the schema and examples.`,
              is_error: true,
            }),
            tool_call_id: tc.id,
          });
          turnToolFailures++;
          continue;
        }
        if (check.warnings.length > 0) {
          console.warn(`[SpecBoost] 潜在警告: ${check.warnings.join("; ")}`);
        }
      }
    }

    deps.knowledgeAdapter.onToolCall(tc);
    deps.executionEventBus.startTool({ runId, attemptId, toolCallId: tc.id, tool: tc.name });
    deps.emit("tool_start", tc.name, tc.arguments);

    let result: ToolResult = prepared.immediateResult ?? {
      tool_call_id: tc.id,
      output: "",
      is_error: false,
    };

    if (!prepared.immediateResult) {
      try {
        result = await deps.pipeline.execute(tc, (t) => dispatch(t));
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
            turnToolFailures++;
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
                const { getPermissionGrantStore } = await import("../guard/permission-grants.js");
                getPermissionGrantStore().remember(tc.name, {
                  reason: "user approval",
                });
              } catch {
                // grant 失败不阻断执行
              }
              result = await dispatch(tc);
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
              turnToolFailures++;
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
          turnToolFailures++;
        }
      }
    } else {
      turnToolFailures++;
    }

    deps.knowledgeAdapter.onToolResult(result, tc.name);
    const usageSnapshot = result.meta?.usageSnapshot as UsageLedgerSnapshot | undefined;
    if (usageSnapshot) deps.usageLedger?.merge(usageSnapshot);
    const backgroundTaskId = result.meta?.backgroundTaskId;
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
    deps.executionEventBus.completeTool({
      runId,
      attemptId,
      toolCallId: tc.id,
      tool: tc.name,
      failed: result.is_error,
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
        turnToolFailures++;
      }
    }

    const preview = result.output.split("\n")[0].slice(0, 80);
    const icon = result.is_error ? "❌" : "✅";
    console.error(icon + " " + tc.name + ": " + preview + (result.output.length > 80 ? "..." : ""));

    if (process.env.QLING_FEATURES_WORKFLOW_RUNTIME === "true") {
      await deps.workflowRuntime.addToolResult(result);
    }

    const rawToolContent = JSON.stringify(result);
    const hygienicContent = prepareToolResultContent(rawToolContent, {
      maxChars: resolveToolResultMaxChars(),
    });
    messages.push({
      role: "tool",
      content: hygienicContent,
      tool_call_id: tc.id,
    });
  }

  return { turnToolCalls, turnToolFailures };
}
