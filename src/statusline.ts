import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import type { SlashCommandContext } from "./slash-context.js";
import { getLocalizedText } from "./i18n/index.js";

export interface StatusLineSnapshot {
  model: string;
  sessionId: string;
  branch: string | null;
  permissionMode: string | null;
  /** agent | plan */
  sessionMode?: string | null;
  goalStatus: string | null;
  activeTasks: number;
  tokens: number;
  promptTokens?: number;
  completionTokens?: number;
  tokenSource?: "provider" | "unknown";
  costPer1kTokens?: number | null;
  costUsd?: string | null;
  costIsPartial?: boolean;
  usageIsIncomplete?: boolean;
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

function formatCostEstimate(tokens: number, costPer1kTokens?: number | null): string {
  const costPer1k = normalizePositiveNumber(costPer1kTokens);
  if (!costPer1k) return "-";
  const used = Math.max(0, Number(tokens ?? 0));
  const estimate = (used / 1000) * costPer1k;
  return `≈$${estimate.toFixed(4)}`;
}

function formatCost(snapshot: StatusLineSnapshot): string {
  if (snapshot.costUsd && !snapshot.costIsPartial && !snapshot.usageIsIncomplete) {
    return `$${snapshot.costUsd}`;
  }
  const estimate = formatCostEstimate(snapshot.tokens, snapshot.costPer1kTokens);
  if (estimate !== "-") return estimate;
  if (snapshot.costIsPartial || snapshot.usageIsIncomplete) return "不完整";
  return "-";
}

function normalizeTokenSource(value: unknown): "provider" | "unknown" {
  return value === "provider" ? "provider" : "unknown";
}

/** Grok 三态：normal | plan | auto */
function formatSessionMode(
  mode: string | null | undefined,
  permissionMode?: string | null
): string {
  const m = String(mode ?? "").trim().toLowerCase();
  const p = String(permissionMode ?? "").trim().toLowerCase();
  if (m === "plan") return "plan";
  if (p === "allow") return "auto";
  return "normal";
}

export function formatStatusLine(snapshot: StatusLineSnapshot): string {
  const t = getLocalizedText();
  const goal = snapshot.goalStatus || "无";
  const branch = snapshot.branch || "-";
  const sessionMode = formatSessionMode(snapshot.sessionMode, snapshot.permissionMode);
  const cost = formatCost(snapshot);
  const prompt = Math.max(0, Math.floor(Number(snapshot.promptTokens ?? 0)));
  const completion = Math.max(0, Math.floor(Number(snapshot.completionTokens ?? 0)));
  const parts = [
    `模型=${snapshot.model || "未知"}`,
    `模式=${sessionMode}`,
    `会话=${resolveShortSessionId(snapshot.sessionId)}`,
    `分支=${branch}`,
    `目标=${goal}`,
    `任务=${snapshot.activeTasks}`,
    `令牌=${Number(snapshot.tokens ?? 0).toLocaleString()}`,
    `in=${prompt.toLocaleString()}`,
    `out=${completion.toLocaleString()}`,
    `来源=${normalizeTokenSource(snapshot.tokenSource)}`,
    cost === "-" ? "成本=-" : cost === "不完整" ? "成本=不完整" : `成本${cost}`,
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
    sessionMode: "agent",
    goalStatus: null,
    activeTasks: 0,
    tokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    tokenSource: "unknown",
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
  const sessionMode =
    typeof agentLoop.getSessionMode === "function"
      ? agentLoop.getSessionMode()
      : typeof agentLoop.isPlanMode === "function" && agentLoop.isPlanMode()
        ? "plan"
        : process.env.QLING_PLAN_MODE === "1"
          ? "plan"
          : "agent";
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
    sessionMode,
    goalStatus: goal?.status ?? null,
    activeTasks,
    tokens: Number(stats.tokens ?? 0),
    promptTokens: Number(stats.promptTokens ?? 0),
    completionTokens: Number(stats.completionTokens ?? 0),
    tokenSource: normalizeTokenSource(stats.tokenSource),
    costPer1kTokens: parseStatusLineCostPer1k(process.env.QLING_STATUSLINE_COST_PER_1K_TOKENS),
    costUsd: stats.costUsd ?? null,
    costIsPartial: Boolean(stats.costIsPartial),
    usageIsIncomplete: Boolean(stats.usageIsIncomplete),
    inputQueue,
  };
}

export async function buildStatusLine(context: SlashCommandContext): Promise<string> {
  return formatStatusLine(await collectStatusLineSnapshot(context));
}
