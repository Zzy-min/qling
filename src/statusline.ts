import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import type { SlashCommandContext } from "./commands/runtime.js";
import { getLocalizedText } from "./i18n/index.js";

export interface StatusLineSnapshot {
  model: string;
  sessionId: string;
  branch: string | null;
  permissionMode: string | null;
  goalStatus: string | null;
  activeTasks: number;
  tokens: number;
  tokenSource?: "provider" | "estimate" | "unknown";
  maxTokens?: number | null;
  costPer1kTokens?: number | null;
  inputQueue?: StatusLineInputQueueSnapshot;
}

export interface StatusLineInputQueueSnapshot {
  pendingCount: number;
  maxPending?: number;
  isProcessing?: boolean;
}

export interface LocalStatusLineSnapshotOptions {
  workspaceDir?: string | null;
  model?: string | null;
  permissionMode?: string | null;
  maxTokens?: number | null;
  costPer1kTokens?: number | null;
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return null;
  }
}

function findGitDir(workspaceDir: string): string | null {
  let current = resolve(workspaceDir);
  while (true) {
    const dotGit = join(current, ".git");
    if (existsSync(dotGit)) {
      const maybeFile = readText(dotGit);
      if (maybeFile?.startsWith("gitdir:")) {
        const gitDir = maybeFile.slice("gitdir:".length).trim();
        return resolve(current, gitDir);
      }
      return dotGit;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function resolveGitBranch(workspaceDir?: string): string | null {
  if (!workspaceDir) return null;
  const gitDir = findGitDir(workspaceDir);
  if (!gitDir) return null;
  const head = readText(join(gitDir, "HEAD"));
  if (!head) return null;
  const prefix = "ref: refs/heads/";
  if (head.startsWith(prefix)) {
    return head.slice(prefix.length);
  }
  return head.slice(0, 7);
}

export function resolveShortSessionId(sessionId: string): string {
  if (!sessionId) return "-";
  return sessionId.length > 12 ? sessionId.slice(0, 12) : sessionId;
}

export function formatPermissionMode(mode: string | null | undefined): string {
  const t = getLocalizedText();
  const m = (mode ?? "").toLowerCase();
  switch (m) {
    case "allow":
      return "允许(自动)";
    case "ask":
      return "询问(确认)";
    case "deny":
      return "拒绝";
    default:
      return "-(未知)";
  }
}

function formatInputQueueStatus(queue?: StatusLineInputQueueSnapshot): string | null {
  if (!queue) return null;
  const pending = Number.isFinite(queue.pendingCount) ? Math.max(0, Math.floor(queue.pendingCount)) : 0;
  if (pending <= 0 && !queue.isProcessing) return null;
  const max = Number.isFinite(queue.maxPending) ? String(Math.max(0, Math.floor(Number(queue.maxPending)))) : "-";
  const state = pending > 0 ? String(pending) : "run";
  return `${state}/${max}`;
}

function normalizePositiveNumber(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric;
}

export function parseStatusLineCostPer1k(raw: unknown): number | null {
  return normalizePositiveNumber(raw);
}

function formatContextUsage(tokens: number, maxTokens?: number | null): string {
  const used = Math.max(0, Math.floor(Number(tokens ?? 0)));
  const max = normalizePositiveNumber(maxTokens);
  if (!max) return `${used.toLocaleString()}/-`;
  const roundedMax = Math.floor(max);
  const pct = Math.round((used / roundedMax) * 100);
  return `${used.toLocaleString()}/${roundedMax.toLocaleString()}(${pct}%)`;
}

function formatCostEstimate(tokens: number, costPer1kTokens?: number | null): string {
  const costPer1k = normalizePositiveNumber(costPer1kTokens);
  if (!costPer1k) return "-";
  const used = Math.max(0, Number(tokens ?? 0));
  const estimate = (used / 1000) * costPer1k;
  return `≈$${estimate.toFixed(4)}`;
}

function normalizeTokenSource(value: unknown): "provider" | "estimate" | "unknown" {
  return value === "provider" || value === "estimate" ? value : "unknown";
}

function resolveTokenBudgetMax(agentLoop: any): number | null {
  const value = agentLoop.getTokenBudget?.()?.maxTokens ?? agentLoop.tokenBudget?.maxTokens;
  return normalizePositiveNumber(value);
}

export function formatStatusLine(snapshot: StatusLineSnapshot): string {
  const t = getLocalizedText();
  const goal = snapshot.goalStatus || "无";
  const branch = snapshot.branch || "-";
  const permission = formatPermissionMode(snapshot.permissionMode);
  const cost = formatCostEstimate(snapshot.tokens, snapshot.costPer1kTokens);
  const parts = [
    `模型=${snapshot.model || "未知"}`,
    `会话=${resolveShortSessionId(snapshot.sessionId)}`,
    `分支=${branch}`,
    `权限=${permission}`,
    `目标=${goal}`,
    `任务=${snapshot.activeTasks}`,
    `令牌=${Number(snapshot.tokens ?? 0).toLocaleString()}`,
    `来源=${normalizeTokenSource(snapshot.tokenSource)}`,
    `上下文=${formatContextUsage(snapshot.tokens, snapshot.maxTokens)}`,
    cost === "-" ? "成本=-" : `成本${cost}`,
  ];
  const queue = formatInputQueueStatus(snapshot.inputQueue);
  if (queue) {
    parts.push(`队列=${queue}`);
  }
  return parts.join("  ");
}

export function collectLocalStatusLineSnapshot(options: LocalStatusLineSnapshotOptions): StatusLineSnapshot {
  return {
    model: options.model || "unknown",
    sessionId: "",
    branch: resolveGitBranch(options.workspaceDir ?? undefined),
    permissionMode: options.permissionMode ?? null,
    goalStatus: null,
    activeTasks: 0,
    tokens: 0,
    tokenSource: "unknown",
    maxTokens: normalizePositiveNumber(options.maxTokens),
    costPer1kTokens: parseStatusLineCostPer1k(options.costPer1kTokens),
  };
}

export async function collectStatusLineSnapshot(context: SlashCommandContext): Promise<StatusLineSnapshot> {
  const agentLoop = context.agentLoop as any;
  const stats = typeof agentLoop.getSessionStats === "function"
    ? await agentLoop.getSessionStats()
    : {
        sessionId: typeof agentLoop.getSessionId === "function" ? agentLoop.getSessionId() : "",
        tokens: agentLoop.sessionTokens ?? 0,
      };
  const tasks = context.scheduler && typeof (context.scheduler as any).listTasks === "function"
    ? await (context.scheduler as any).listTasks()
    : [];
  const activeTasks = Array.isArray(tasks)
    ? tasks.filter((task: any) => task.status !== "canceled" && task.status !== "completed").length
    : 0;
  const goal = context.goalController && typeof (context.goalController as any).getGoalStatus === "function"
    ? await (context.goalController as any).getGoalStatus()
    : null;
  const permissionMode = typeof agentLoop.getPermissionMode === "function"
    ? agentLoop.getPermissionMode()
    : process.env.QLING_GUARD_PERMISSIONS_DEFAULT ?? null;
  const inputQueue = context.inputQueue
    ? {
        pendingCount: Number(context.inputQueue.pendingCount ?? 0),
        maxPending: context.inputQueue.maxPending,
        isProcessing: Boolean(context.inputQueue.isProcessing),
      }
    : undefined;

  return {
    model: typeof agentLoop.getModel === "function" ? agentLoop.getModel() : "unknown",
    sessionId: stats.sessionId ?? "",
    branch: resolveGitBranch(context.workspaceDir),
    permissionMode,
    goalStatus: goal?.status ?? null,
    activeTasks,
    tokens: Number(stats.tokens ?? 0),
    tokenSource: normalizeTokenSource(stats.tokenSource),
    maxTokens: resolveTokenBudgetMax(agentLoop),
    costPer1kTokens: parseStatusLineCostPer1k(process.env.QLING_STATUSLINE_COST_PER_1K_TOKENS),
    inputQueue,
  };
}

export async function buildStatusLine(context: SlashCommandContext): Promise<string> {
  return formatStatusLine(await collectStatusLineSnapshot(context));
}
