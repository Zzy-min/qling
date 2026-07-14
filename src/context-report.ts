import { join } from "path";
import { homedir } from "os";
import type { SlashCommandContext } from "./slash-context.js";
import { formatLocalPanel } from "./output-style.js";
import { SessionRegistry } from "./session/session-registry.js";
import {
  formatProviderTokenLine,
  type TokenUsageSource,
} from "./token-usage.js";
import {
  estimateContextLayers,
  type ContextLayerEstimate,
} from "./context-tool-hygiene.js";

export interface ContextReport {
  sessionId: string;
  turnCount: number;
  messageCount: number;
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  tokenSource: TokenUsageSource;
  tokenSourceDescription: string;
  recommendation: string;
  compactions: number;
  /** 本地字符层估计（非 provider token） */
  layers: ContextLayerEstimate | null;
  workspaceDir: string;
  stateDir: string;
  cacheDir: string;
  sessionsDir: string;
  savedSessionCount: number;
  latestSavedSessionAt: string | null;
}

export interface ContextReportOptions {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

export interface LocalContextReportOptions {
  workspaceDir: string;
  stateDir: string;
  cacheDir?: string;
}

function resolveStateDir(env: ContextReportOptions["env"], agentLoop: any): string {
  return env?.QLING_FILE_STATE_DIR
    || agentLoop.getRuntimeRootDir?.()
    || join(homedir(), ".qling");
}

function resolveCacheDir(env: ContextReportOptions["env"], stateDir: string): string {
  return env?.QLING_FILE_CACHE_DIR || join(stateDir, "cache");
}

export function formatTokenUsage(options: {
  tokens: number;
  promptTokens?: number;
  completionTokens?: number;
  source?: TokenUsageSource;
}): string {
  return formatProviderTokenLine({
    tokens: options.tokens,
    promptTokens: options.promptTokens,
    completionTokens: options.completionTokens,
    source: options.source,
  });
}

function describeTokenSource(source: TokenUsageSource): string {
  switch (source) {
    case "provider":
      return "provider 官方 usage（prompt/completion/total 字段）；适合账单与用量统计。";
    default:
      return "unknown：本会话尚未收到 provider usage；不会用本地字符估算伪造 token。";
  }
}

function describeRecommendation(options: {
  tokenSource: TokenUsageSource;
  compactions: number;
  messageCount: number;
}): string {
  if (options.tokenSource === "unknown") {
    return "当前无官方 usage。请确认模型 API 返回 usage；部分代理层可能剥离该字段。";
  }
  if (options.compactions > 0 || options.messageCount >= 40) {
    return "上下文较长或已压缩过，可按需 /compact 或保存 checkpoint 后继续。";
  }
  return "Token 来自 provider 官方 usage，可继续推进。";
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
        promptTokens: 0,
        completionTokens: 0,
        tokenSource: "unknown",
        compactions: agentLoop.compactionCount ?? 0,
      };
  const messages = typeof agentLoop.getMessagesSnapshot === "function"
    ? await agentLoop.getMessagesSnapshot()
    : [];
  const savedSessions = context.listSavedSessions ? await context.listSavedSessions() : [];
  const stateDir = resolveStateDir(env, agentLoop);
  const cacheDir = resolveCacheDir(env, stateDir);
  const tokens = Number(stats.tokens ?? 0);
  const promptTokens = Number(stats.promptTokens ?? 0);
  const completionTokens = Number(stats.completionTokens ?? 0);
  const tokenSource = normalizeTokenSource(stats.tokenSource);
  const messageCount = Array.isArray(messages) ? messages.length : Number(stats.messageCount ?? 0);
  const compactions = Number(stats.compactions ?? stats.compactionCount ?? 0);
  const layers = Array.isArray(messages) && messages.length > 0
    ? estimateContextLayers(messages)
    : null;

  return {
    sessionId: stats.sessionId || agentLoop.getSessionId?.() || "-",
    turnCount: Number(stats.turnCount ?? 0),
    messageCount,
    tokens,
    promptTokens,
    completionTokens,
    tokenSource,
    tokenSourceDescription: describeTokenSource(tokenSource),
    recommendation: describeRecommendation({ tokenSource, compactions, messageCount }),
    compactions,
    layers,
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
  const tokenSource: TokenUsageSource = "unknown";

  return {
    sessionId: "-",
    turnCount: 0,
    messageCount: 0,
    tokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    tokenSource,
    tokenSourceDescription: describeTokenSource(tokenSource),
    recommendation: describeRecommendation({ tokenSource, compactions: 0, messageCount: 0 }),
    compactions: 0,
    layers: null,
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
        heading: "Token（官方 usage）",
        rows: [
          ["Token", formatTokenUsage({
            tokens: report.tokens,
            promptTokens: report.promptTokens,
            completionTokens: report.completionTokens,
            source: report.tokenSource,
          })],
          ["输入 tokens", report.promptTokens.toLocaleString()],
          ["输出 tokens", report.completionTokens.toLocaleString()],
          ["Token 来源", report.tokenSource],
          ["Token 说明", report.tokenSourceDescription],
          ["建议", report.recommendation],
        ],
      },
      {
        heading: "Harness 层（本地字符估计）",
        rows: report.layers
          ? [
              ["对话 history", `${report.layers.historyChars.toLocaleString()} 字符 (${report.layers.historyPct}%)`],
              ["工具输出", `${report.layers.toolOutputChars.toLocaleString()} 字符 (${report.layers.toolOutputPct}%)`],
              ["其他", `${report.layers.otherChars.toLocaleString()} 字符 (${report.layers.otherPct}%)`],
              ["合计字符", report.layers.totalChars.toLocaleString()],
              ["工具消息数", report.layers.toolMessageCount],
              ["说明", "非 provider token；用于观察 harness 膨胀。超长工具结果默认折叠（QLING_TOOL_RESULT_MAX_CHARS）。"],
            ]
          : [
              ["状态", "当前无会话消息快照"],
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

function normalizeTokenSource(value: unknown): TokenUsageSource {
  return value === "provider" ? "provider" : "unknown";
}
