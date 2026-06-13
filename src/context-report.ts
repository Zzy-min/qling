import { join } from "path";
import { homedir } from "os";
import type { SlashCommandContext } from "./commands/runtime.js";
import { formatLocalPanel } from "./output-style.js";
import { SessionRegistry } from "./session/session-registry.js";

export interface ContextReport {
  sessionId: string;
  turnCount: number;
  messageCount: number;
  tokens: number;
  tokenSource: "provider" | "estimate" | "unknown";
  tokenSourceDescription: string;
  maxTokens: number | null;
  tokenUsagePercent: number | null;
  contextLevel: "ok" | "watch" | "critical" | "unknown";
  recommendation: string;
  compactions: number;
  workspaceDir: string;
  stateDir: string;
  cacheDir: string;
  sessionsDir: string;
  savedSessionCount: number;
  latestSavedSessionAt: string | null;
}

export interface ContextReportOptions {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  maxTokens?: number | null;
}

export interface LocalContextReportOptions {
  workspaceDir: string;
  stateDir: string;
  cacheDir?: string;
  maxTokens?: number | null;
}

function resolveStateDir(env: ContextReportOptions["env"], agentLoop: any): string {
  return env?.QLING_FILE_STATE_DIR
    || agentLoop.getRuntimeRootDir?.()
    || join(homedir(), ".qling");
}

function resolveCacheDir(env: ContextReportOptions["env"], stateDir: string): string {
  return env?.QLING_FILE_CACHE_DIR || join(stateDir, "cache");
}

function resolveMaxTokens(options: ContextReportOptions, agentLoop: any): number | null {
  if (typeof options.maxTokens === "number" && options.maxTokens > 0) {
    return options.maxTokens;
  }
  const fromAgent = agentLoop.getTokenBudget?.()?.maxTokens ?? agentLoop.tokenBudget?.maxTokens;
  return typeof fromAgent === "number" && fromAgent > 0 ? fromAgent : null;
}

export function formatTokenUsage(tokens: number, maxTokens: number | null | undefined): string {
  const used = Number(tokens ?? 0);
  if (!maxTokens || maxTokens <= 0) {
    return `${used.toLocaleString()} / unknown`;
  }
  const pct = Math.round((used / maxTokens) * 100);
  return `${used.toLocaleString()} / ${maxTokens.toLocaleString()} (${pct}%)`;
}

function classifyContextLevel(percent: number | null): ContextReport["contextLevel"] {
  if (percent === null) return "unknown";
  if (percent >= 90) return "critical";
  if (percent >= 70) return "watch";
  return "ok";
}

function describeContextRecommendation(level: ContextReport["contextLevel"]): string {
  switch (level) {
    case "critical":
      return "立即保存 checkpoint 并执行 /compact，避免后续回复被截断或上下文丢失。";
    case "watch":
      return "建议在继续长任务前保存 checkpoint；如输出变长，提前 /compact。";
    case "ok":
      return "当前上下文占用正常，可继续推进。";
    default:
      return "未配置可用 token 预算，建议设置 max token budget 以获得准确上下文水位。";
  }
}

function describeTokenSource(source: ContextReport["tokenSource"]): string {
  switch (source) {
    case "provider":
      return "provider reported usage; suitable for accurate accounting when the provider returns usage.";
    case "estimate":
      return "local estimate; useful for context planning but not exact billing.";
    default:
      return "unknown; provider usage and local estimate are unavailable.";
  }
}

export async function buildContextReport(
  context: SlashCommandContext,
  options: ContextReportOptions = {}
): Promise<ContextReport> {
  const env = options.env ?? process.env;
  const agentLoop = context.agentLoop as any;
  const stats = typeof agentLoop.getSessionStats === "function"
    ? await agentLoop.getSessionStats()
    : {
        sessionId: agentLoop.getSessionId?.() ?? "",
        turnCount: agentLoop.turnCount ?? 0,
        tokens: agentLoop.sessionTokens ?? 0,
        tokenSource: "unknown",
        compactions: agentLoop.compactionCount ?? 0,
      };
  const messages = typeof agentLoop.getMessagesSnapshot === "function"
    ? await agentLoop.getMessagesSnapshot()
    : [];
  const savedSessions = context.listSavedSessions ? await context.listSavedSessions() : [];
  const stateDir = resolveStateDir(env, agentLoop);
  const cacheDir = resolveCacheDir(env, stateDir);
  const maxTokens = resolveMaxTokens(options, agentLoop);
  const tokens = Number(stats.tokens ?? 0);
  const tokenUsagePercent = maxTokens ? Math.round((tokens / maxTokens) * 100) : null;
  const tokenSource = normalizeTokenSource(stats.tokenSource);
  const contextLevel = classifyContextLevel(tokenUsagePercent);

  return {
    sessionId: stats.sessionId || agentLoop.getSessionId?.() || "-",
    turnCount: Number(stats.turnCount ?? 0),
    messageCount: Array.isArray(messages) ? messages.length : Number(stats.messageCount ?? 0),
    tokens,
    tokenSource,
    tokenSourceDescription: describeTokenSource(tokenSource),
    maxTokens,
    tokenUsagePercent,
    contextLevel,
    recommendation: describeContextRecommendation(contextLevel),
    compactions: Number(stats.compactions ?? stats.compactionCount ?? 0),
    workspaceDir: context.workspaceDir || agentLoop.getWorkspaceDir?.() || process.cwd(),
    stateDir,
    cacheDir,
    sessionsDir: join(stateDir, "sessions"),
    savedSessionCount: savedSessions.length,
    latestSavedSessionAt: savedSessions[0]?.updatedAt ?? null,
  };
}

export async function buildLocalContextReport(options: LocalContextReportOptions): Promise<ContextReport> {
  const registry = new SessionRegistry({ stateDir: options.stateDir });
  const savedSessions = await registry.list();
  const maxTokens = typeof options.maxTokens === "number" && options.maxTokens > 0
    ? options.maxTokens
    : null;
  const tokenUsagePercent = maxTokens ? 0 : null;
  const tokenSource = "unknown";
  const contextLevel = classifyContextLevel(tokenUsagePercent);

  return {
    sessionId: "-",
    turnCount: 0,
    messageCount: 0,
    tokens: 0,
    tokenSource,
    tokenSourceDescription: describeTokenSource(tokenSource),
    maxTokens,
    tokenUsagePercent,
    contextLevel,
    recommendation: describeContextRecommendation(contextLevel),
    compactions: 0,
    workspaceDir: options.workspaceDir,
    stateDir: options.stateDir,
    cacheDir: options.cacheDir || join(options.stateDir, "cache"),
    sessionsDir: join(options.stateDir, "sessions"),
    savedSessionCount: savedSessions.length,
    latestSavedSessionAt: savedSessions[0]?.updatedAt ?? null,
  };
}

export function formatContextReport(report: ContextReport): string[] {
  return formatLocalPanel({
    icon: "🧭",
    title: "本地上下文",
    sections: [
      {
        heading: "会话",
        rows: [
          ["Session ID", report.sessionId],
          ["轮次", report.turnCount],
          ["消息数", report.messageCount],
          ["压缩次数", report.compactions],
        ],
      },
      {
        heading: "Token 与状态",
        rows: [
          ["Token", formatTokenUsage(report.tokens, report.maxTokens)],
          ["Token 来源", report.tokenSource],
          ["Token 说明", report.tokenSourceDescription],
          ["上下文状态", report.contextLevel],
          ["建议", report.recommendation],
        ],
      },
      {
        heading: "本地路径",
        rows: [
          ["Workspace", report.workspaceDir],
          ["State dir", report.stateDir],
          ["Cache dir", report.cacheDir],
          ["Sessions", report.sessionsDir],
          ["已存快照", report.savedSessionCount],
          ["最近保存", report.latestSavedSessionAt ?? "-"],
        ],
      },
    ],
    boundary: "/context 只展示本地统计与路径，不输出消息正文，不上传上下文。",
  });
}

function normalizeTokenSource(value: unknown): ContextReport["tokenSource"] {
  return value === "provider" || value === "estimate" ? value : "unknown";
}
