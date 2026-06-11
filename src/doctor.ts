import { existsSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import type { SlashCommandContext } from "./commands/runtime.js";
import { resolveGitBranch } from "./statusline.js";
import { sanitizeEndpoint } from "./config-report.js";
import { buildLocalMcpReport } from "./mcp-report.js";
import { guardConfigFromEnv } from "./config.js";
import { buildLocalHooksReport } from "./hooks-report.js";

export type DoctorStatus = "pass" | "warn" | "fail";

export interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorStatus;
  detail: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  summary: Record<DoctorStatus, number>;
  recommendations: string[];
}

export interface DoctorOptions {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  exists?: (path: string) => boolean;
  gitBranch?: (workspaceDir?: string) => string | null;
  nodeVersion?: string;
  daemonProbe?: () => Promise<{ ok: boolean; detail: string }>;
}

const DEFAULT_STATE_DIR = join(homedir(), ".qling");
const DEFAULT_DAEMON_HEALTH_URL = "http://127.0.0.1:39871/health";

function summarize(checks: DoctorCheck[]): Record<DoctorStatus, number> {
  return checks.reduce<Record<DoctorStatus, number>>(
    (acc, check) => ({ ...acc, [check.status]: acc[check.status] + 1 }),
    { pass: 0, warn: 0, fail: 0 }
  );
}

function checkLocalPath(id: string, label: string, path: string, exists: (path: string) => boolean): DoctorCheck {
  const resolved = resolve(path);
  return exists(resolved)
    ? { id, label, status: "pass", detail: resolved }
    : { id, label, status: "warn", detail: `${resolved} 不存在；首次运行或迁移前可能需要初始化。` };
}

function isLoopbackUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function envText(env: DoctorOptions["env"], name: string): string {
  const value = env?.[name];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function envNumber(env: DoctorOptions["env"], name: string): number {
  const value = Number(envText(env, name));
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function boolText(value: boolean): "on" | "off" {
  return value ? "on" : "off";
}

function buildConfigCheck(env: DoctorOptions["env"]): DoctorCheck {
  const provider = envText(env, "QLING_LLM_PROVIDER") || "unset";
  const model = envText(env, "QLING_LLM_MODEL") || "unset";
  const endpoint = sanitizeEndpoint(envText(env, "QLING_LLM_ENDPOINT"));
  const apiKeyStatus = envText(env, "QLING_LLM_API_KEY") ? "set(redacted)" : "missing";

  return {
    id: "config",
    label: "config",
    status: apiKeyStatus === "missing" ? "warn" : "pass",
    detail: `provider=${provider} model=${model} endpoint=${endpoint} api_key=${apiKeyStatus}`,
  };
}

function buildRecommendations(checks: DoctorCheck[]): string[] {
  const recommendations: string[] = [];
  const byId = new Map(checks.map((check) => [check.id, check]));

  if (byId.get("config")?.status === "warn") {
    recommendations.push("- 运行 `qling setup` 配置本地 Provider、模型和 API key。");
  }

  const stateDir = byId.get("state_dir");
  const cacheDir = byId.get("cache_dir");
  if (stateDir?.status === "warn" || cacheDir?.status === "warn") {
    recommendations.push("- 首次运行会初始化本地数据目录；如需预先创建，可检查 `qling storage` 输出的路径。");
  }

  if (byId.get("daemon")?.status === "warn") {
    recommendations.push("- 如需后台任务或使命附着，运行 `qling daemon start` 后再执行 `qling doctor`。");
  }

  if (byId.get("git")?.status === "warn") {
    recommendations.push("- 在 Git 仓库内运行可获得更完整的分支和工作区诊断。");
  }

  return recommendations;
}

function buildMcpCheck(env: DoctorOptions["env"]): DoctorCheck {
  const report = buildLocalMcpReport(
    {
      servers: {},
      connection_timeout_ms: envNumber(env, "QLING_MCP_CONNECTION_TIMEOUT_MS"),
      call_timeout_ms: envNumber(env, "QLING_MCP_CALL_TIMEOUT_MS"),
    },
    env as Record<string, string | undefined>
  );

  return {
    id: "mcp",
    label: "MCP",
    status: "pass",
    detail: `enabled=${report.enabled}/${report.total} connect=${report.connectionTimeoutMs}ms call=${report.callTimeoutMs}ms`,
  };
}

function buildHooksCheck(env: DoctorOptions["env"]): DoctorCheck {
  const report = buildLocalHooksReport(guardConfigFromEnv(env as NodeJS.ProcessEnv));

  return {
    id: "hooks",
    label: "hooks",
    status: report.guardEnabled ? "pass" : "warn",
    detail: `guard=${boolText(report.guardEnabled)} permission=${report.permissionDefault} rules=${report.permissionRuleCount} rate_limit=${boolText(report.rateLimitEnabled)}(${report.rateLimitMaxPerMinute}/min) content_filter=${boolText(report.contentFilterEnabled)} custom=${report.customContentPatternCount}`,
  };
}

async function probeDaemon(env: DoctorOptions["env"]): Promise<{ ok: boolean; detail: string }> {
  const url = env?.QLING_DAEMON_HEALTH_URL ?? DEFAULT_DAEMON_HEALTH_URL;
  if (!isLoopbackUrl(url)) {
    return { ok: false, detail: "跳过：daemon health URL 不是本机 loopback。生产诊断不会访问公网。" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 800);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok
      ? { ok: true, detail: `${url} reachable` }
      : { ok: false, detail: `${url} HTTP ${response.status}` };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function buildDoctorReport(
  context: SlashCommandContext,
  options: DoctorOptions = {}
): Promise<DoctorReport> {
  const env = options.env ?? process.env;
  const exists = options.exists ?? existsSync;
  const gitBranch = options.gitBranch ?? resolveGitBranch;
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  const stateDir = env.QLING_FILE_STATE_DIR || join(homedir(), ".qling");
  const cacheDir = env.QLING_FILE_CACHE_DIR || join(stateDir, "cache");
  const workspaceDir = context.workspaceDir || (context.agentLoop as any).getWorkspaceDir?.() || process.cwd();
  const stats = typeof (context.agentLoop as any).getSessionStats === "function"
    ? await (context.agentLoop as any).getSessionStats()
    : { sessionId: (context.agentLoop as any).getSessionId?.() ?? "" };
  const permissionMode = typeof (context.agentLoop as any).getPermissionMode === "function"
    ? (context.agentLoop as any).getPermissionMode()
    : env.QLING_GUARD_PERMISSIONS_DEFAULT;
  const branch = gitBranch(workspaceDir);
  const daemon = options.daemonProbe ? await options.daemonProbe() : await probeDaemon(env);

  const checks: DoctorCheck[] = [
    {
      id: "node",
      label: "Node runtime",
      status: nodeVersion ? "pass" : "fail",
      detail: nodeVersion ? `v${nodeVersion}` : "无法读取 Node 版本。",
    },
    checkLocalPath("workspace", "workspace", workspaceDir, exists),
    {
      id: "git",
      label: "git",
      status: branch ? "pass" : "warn",
      detail: branch ? `branch=${branch}` : "当前 workspace 不是 git 仓库或无法读取分支。",
    },
    checkLocalPath("state_dir", "本地 state 目录", stateDir || DEFAULT_STATE_DIR, exists),
    checkLocalPath("cache_dir", "本地 cache 目录", cacheDir, exists),
    {
      id: "session",
      label: "session",
      status: stats.sessionId ? "pass" : "warn",
      detail: stats.sessionId ? `sessionId=${stats.sessionId}` : "当前会话尚无 session id。",
    },
    {
      id: "permission",
      label: "permission",
      status: permissionMode ? "pass" : "warn",
      detail: permissionMode ? `mode=${permissionMode}` : "未显式配置权限默认策略。",
    },
    buildConfigCheck(env),
    buildMcpCheck(env),
    buildHooksCheck(env),
    {
      id: "daemon",
      label: "qlingd",
      status: daemon.ok ? "pass" : "warn",
      detail: daemon.detail,
    },
  ];

  return {
    checks,
    summary: summarize(checks),
    recommendations: buildRecommendations(checks),
  };
}

function icon(status: DoctorStatus): string {
  if (status === "pass") return "PASS";
  if (status === "warn") return "WARN";
  return "FAIL";
}

export function formatDoctorReport(report: DoctorReport): string[] {
  const lines = [
    "",
    "🩺 轻灵 Doctor（本地诊断）",
    "-----------------------------------------",
    `Summary: pass=${report.summary.pass} warn=${report.summary.warn} fail=${report.summary.fail}`,
  ];
  for (const check of report.checks) {
    lines.push(`[${icon(check.status)}] ${check.label}: ${check.detail}`);
  }
  if (report.recommendations.length > 0) {
    lines.push("");
    lines.push("Next steps:");
    lines.push(...report.recommendations);
  }
  lines.push("-----------------------------------------");
  lines.push("说明: Doctor 只读取本地状态与本机 loopback，不上传诊断数据。");
  lines.push("");
  return lines;
}
