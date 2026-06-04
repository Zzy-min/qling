import { join } from "path";
import { homedir } from "os";
import type { SlashCommandContext } from "./commands/runtime.js";
import { SessionRegistry } from "./session/session-registry.js";

export interface ContextReport {
  sessionId: string;
  turnCount: number;
  messageCount: number;
  tokens: number;
  maxTokens: number | null;
  tokenUsagePercent: number | null;
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
  return env?.QINGLING_FILE_STATE_DIR
    || agentLoop.getRuntimeRootDir?.()
    || join(homedir(), ".qingling");
}

function resolveCacheDir(env: ContextReportOptions["env"], stateDir: string): string {
  return env?.QINGLING_FILE_CACHE_DIR || join(stateDir, "cache");
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

  return {
    sessionId: stats.sessionId || agentLoop.getSessionId?.() || "-",
    turnCount: Number(stats.turnCount ?? 0),
    messageCount: Array.isArray(messages) ? messages.length : Number(stats.messageCount ?? 0),
    tokens,
    maxTokens,
    tokenUsagePercent: maxTokens ? Math.round((tokens / maxTokens) * 100) : null,
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

  return {
    sessionId: "-",
    turnCount: 0,
    messageCount: 0,
    tokens: 0,
    maxTokens,
    tokenUsagePercent: maxTokens ? 0 : null,
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
  return [
    "",
    "🧭 【本地上下文】",
    "-----------------------------------------",
    `Session ID : ${report.sessionId}`,
    `轮次       : ${report.turnCount}`,
    `消息数     : ${report.messageCount}`,
    `Token      : ${formatTokenUsage(report.tokens, report.maxTokens)}`,
    `压缩次数   : ${report.compactions}`,
    `Workspace  : ${report.workspaceDir}`,
    `State dir  : ${report.stateDir}`,
    `Cache dir  : ${report.cacheDir}`,
    `Sessions   : ${report.sessionsDir}`,
    `已存快照   : ${report.savedSessionCount}`,
    `最近保存   : ${report.latestSavedSessionAt ?? "-"}`,
    "-----------------------------------------",
    "说明: /context 只展示本地统计与路径，不输出消息正文，不上传上下文。",
    "",
  ];
}
