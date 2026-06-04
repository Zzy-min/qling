import { homedir } from "os";
import { join } from "path";
import type { SlashCommandContext } from "./commands/runtime.js";
import { SessionRegistry } from "./session/session-registry.js";

export interface PrivacyReport {
  workspaceDir: string;
  stateDir: string;
  sessionsDir: string;
  cacheDir: string;
  savedSessionCount: number;
  model: string;
}

export interface PrivacyReportOptions {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

export interface LocalPrivacyReportOptions {
  workspaceDir: string;
  stateDir: string;
  cacheDir?: string;
  model?: string;
}

function resolveStateDir(env: PrivacyReportOptions["env"], agentLoop: any): string {
  return env?.QLING_FILE_STATE_DIR
    || agentLoop.getRuntimeRootDir?.()
    || join(homedir(), ".qling");
}

function resolveCacheDir(env: PrivacyReportOptions["env"], stateDir: string): string {
  return env?.QLING_FILE_CACHE_DIR || join(stateDir, "cache");
}

export async function buildPrivacyReport(
  context: SlashCommandContext,
  options: PrivacyReportOptions = {}
): Promise<PrivacyReport> {
  const env = options.env ?? process.env;
  const agentLoop = context.agentLoop as any;
  const stateDir = resolveStateDir(env, agentLoop);
  const savedSessions = context.listSavedSessions ? await context.listSavedSessions() : [];

  return {
    workspaceDir: context.workspaceDir || agentLoop.getWorkspaceDir?.() || process.cwd(),
    stateDir,
    sessionsDir: join(stateDir, "sessions"),
    cacheDir: resolveCacheDir(env, stateDir),
    savedSessionCount: Array.isArray(savedSessions) ? savedSessions.length : 0,
    model: agentLoop.getModel?.() || "unknown",
  };
}

export async function buildLocalPrivacyReport(options: LocalPrivacyReportOptions): Promise<PrivacyReport> {
  const registry = new SessionRegistry({ stateDir: options.stateDir });
  const savedSessions = await registry.list();

  return {
    workspaceDir: options.workspaceDir,
    stateDir: options.stateDir,
    sessionsDir: join(options.stateDir, "sessions"),
    cacheDir: options.cacheDir || join(options.stateDir, "cache"),
    savedSessionCount: savedSessions.length,
    model: options.model || "unknown",
  };
}

export function formatPrivacyReport(report: PrivacyReport): string[] {
  return [
    "",
    "🔒 【本地数据留存】",
    "-----------------------------------------",
    `Workspace  : ${report.workspaceDir}`,
    `State dir  : ${report.stateDir}`,
    `Sessions   : ${report.sessionsDir}`,
    `Cache dir  : ${report.cacheDir}`,
    `已存快照   : ${report.savedSessionCount}`,
    `模型配置   : ${report.model}`,
    "-----------------------------------------",
    "本命令只读取本地状态，不上传诊断数据，也不扫描消息正文。",
    "边界说明: 模型请求仍按 provider 配置发送必要上下文；如需完全离线，需要配置本地模型/provider。",
    "提示: 用 /context 查看上下文占用，用 /doctor 检查本地稳定性。",
    "",
  ];
}
