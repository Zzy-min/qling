import { homedir } from "os";
import { join } from "path";
import type { SlashCommandContext } from "./slash-context.js";
import { SessionRegistry } from "./session/session-registry.js";
import { scanRuntimeDotEnvSecrets, type EnvSecretHit } from "./config.js";
import { getLocalizedText } from "./i18n/index.js";

export interface PrivacyReport {
  workspaceDir: string;
  stateDir: string;
  sessionsDir: string;
  cacheDir: string;
  savedSessionCount: number;
  model: string;
  plaintextSecretHits: EnvSecretHit[];
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
  const hits = await scanRuntimeDotEnvSecrets(stateDir);

  return {
    workspaceDir: context.workspaceDir || agentLoop.getWorkspaceDir?.() || process.cwd(),
    stateDir,
    sessionsDir: join(stateDir, "sessions"),
    cacheDir: resolveCacheDir(env, stateDir),
    savedSessionCount: Array.isArray(savedSessions) ? savedSessions.length : 0,
    model: agentLoop.getModel?.() || "unknown",
    plaintextSecretHits: hits,
  };
}

export async function buildLocalPrivacyReport(options: LocalPrivacyReportOptions): Promise<PrivacyReport> {
  const registry = new SessionRegistry({ stateDir: options.stateDir });
  const savedSessions = await registry.list();
  const hits = await scanRuntimeDotEnvSecrets(options.stateDir);

  return {
    workspaceDir: options.workspaceDir,
    stateDir: options.stateDir,
    sessionsDir: join(options.stateDir, "sessions"),
    cacheDir: options.cacheDir || join(options.stateDir, "cache"),
    savedSessionCount: savedSessions.length,
    model: options.model || "unknown",
    plaintextSecretHits: hits,
  };
}

export function formatPrivacyReport(report: PrivacyReport): string[] {
  const secretLines: string[] = [];
  if (report.plaintextSecretHits && report.plaintextSecretHits.length > 0) {
    const byFile = new Map<string, string[]>();
    for (const h of report.plaintextSecretHits) {
      if (!byFile.has(h.file)) byFile.set(h.file, []);
      byFile.get(h.file)!.push(h.varName);
    }
    secretLines.push("");
    secretLines.push("⚠️  检测到运行时明文密钥（仅显示变量名）：");
    for (const [f, vars] of byFile.entries()) {
      secretLines.push(`   ${f} : ${vars.join(", ")}`);
    }
    secretLines.push("   建议：轮换密钥 → 移至系统环境变量 → 删除 .env 中对应行 → 重新运行 /privacy 或 /doctor 确认。");
  }

  const t = getLocalizedText();
  return [
    "",
    `🔒 【${t.privacy?.title || "本地数据留存"}】`,
    "-----------------------------------------",
    `${t.privacy?.workspaceDir || "Workspace"}  : ${report.workspaceDir}`,
    `${t.privacy?.stateDir || "State dir"}  : ${report.stateDir}`,
    `${t.privacy?.sessionsDir || "Sessions"}   : ${report.sessionsDir}`,
    `${t.privacy?.cacheDir || "Cache dir"}  : ${report.cacheDir}`,
    `已存快照   : ${report.savedSessionCount}`,
    `${t.labels.model || "模型配置"}   : ${report.model}`,
    ...secretLines,
    "-----------------------------------------",
    "本命令只读取本地状态，不上传诊断数据，也不扫描消息正文。",
    "OTEL 外部观测默认关闭；即使双重确认启用，也只导出固定白名单元数据，不导出正文、Prompt、路径或工具参数。",
    "边界说明: 模型请求仍按 provider 配置发送必要上下文；如需完全离线，需要配置本地模型/provider。",
    "提示: 用 /context 查看上下文占用，用 /doctor 检查本地稳定性。",
    "",
  ];
}
