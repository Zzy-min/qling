import { existsSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import type { SlashCommandContext } from "./commands/runtime.js";
import { resolveGitBranch } from "./statusline.js";
import { sanitizeEndpoint } from "./config-report.js";
import { buildLocalMcpReport } from "./mcp-report.js";
import { guardConfigFromEnv, scanRuntimeDotEnvSecrets, type EnvSecretHit } from "./config.js";
import { buildLocalHooksReport } from "./hooks-report.js";
import { getLocalizedText } from "./i18n/index.js";

const t = getLocalizedText();

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
  /** 注入 Ollama 探测结果；未提供时探测本机 loopback */
  ollamaProbe?: () => Promise<{ ok: boolean; detail: string }>;
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
  const t = getLocalizedText();
  return exists(resolved)
    ? { id, label, status: "pass", detail: resolved }
    : { id, label, status: "warn", detail: `${resolved} ${t.doctor ? "不存在；首次运行或迁移前可能需要初始化。" : ""}` };
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

function envFlagOn(env: DoctorOptions["env"], name: string): boolean {
  const raw = envText(env, name).toLowerCase();
  return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
}

/** Phase 3 可选能力开关（informational） */
export function buildPhase3FeatureChecks(env: DoctorOptions["env"] = process.env): DoctorCheck[] {
  const browserAct = envFlagOn(env, "QLING_BROWSER_ACT");
  const parallel = envFlagOn(env, "QLING_SUBTASK_PARALLEL");
  const missionNotify = envText(env, "QLING_MISSION_NOTIFY").toLowerCase();
  const notifyOn = !(missionNotify === "off" || missionNotify === "0" || missionNotify === "false");
  const logMode = envText(env, "QLING_MISSION_NOTIFY_LOGS") || "milestone";
  const style = envText(env, "QLING_MISSION_NOTIFY_STYLE") || "rich";
  const hasTg = Boolean(envText(env, "QLING_CHANNEL_TELEGRAM_TOKEN"));
  const hasSlack = Boolean(envText(env, "QLING_CHANNEL_SLACK_BOT_TOKEN"));

  return [
    {
      id: "phase3_browser_act",
      label: "phase3:browser_act",
      status: browserAct ? "pass" : "warn",
      detail: browserAct
        ? "QLING_BROWSER_ACT=on（交互浏览已启用）"
        : "默认关闭；启用设 QLING_BROWSER_ACT=1，见 docs/web-routing.md",
    },
    {
      id: "phase3_subtask_parallel",
      label: "phase3:subtask_parallel",
      status: parallel ? "pass" : "warn",
      detail: parallel
        ? "QLING_SUBTASK_PARALLEL=on（explore 并行已启用）"
        : "默认关闭；启用设 QLING_SUBTASK_PARALLEL=1",
    },
    {
      id: "phase3_mission_notify",
      label: "phase3:mission_notify",
      status: notifyOn && (hasTg || hasSlack) ? "pass" : notifyOn ? "warn" : "pass",
      detail: `notify=${notifyOn ? "on" : "off"} style=${style} logs=${logMode} telegram=${hasTg ? "token" : "none"} slack=${hasSlack ? "token" : "none"}`,
    },
    {
      id: "phase4_lsp",
      label: "phase4:lsp",
      status: envFlagOn(env, "QLING_LSP") ? "pass" : "warn",
      detail: envFlagOn(env, "QLING_LSP")
        ? "QLING_LSP=on（TS LanguageService 语义查询已启用）"
        : "默认关闭；启用设 QLING_LSP=1（需 typescript 包）",
    },
  ];
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

async function buildSecretsCheck(): Promise<DoctorCheck> {
  const hits: EnvSecretHit[] = await scanRuntimeDotEnvSecrets();
  if (hits.length === 0) {
    return {
      id: "secrets",
      label: "secrets",
      status: "pass",
      detail: "未在 ~/.qling/.env 或项目 .env 发现明文密钥变量",
    };
  }
  // Group by file, list only var names
  const byFile = new Map<string, string[]>();
  for (const h of hits) {
    if (!byFile.has(h.file)) byFile.set(h.file, []);
    byFile.get(h.file)!.push(h.varName);
  }
  const details = Array.from(byFile.entries())
    .map(([f, vars]) => `${f} → ${vars.join(", ")}`)
    .join(" | ");
  return {
    id: "secrets",
    label: "secrets",
    status: "warn",
    detail: `检测到明文密钥变量（仅列出变量名）: ${details}`,
  };
}

function buildRecommendations(checks: DoctorCheck[]): string[] {
  const recommendations: string[] = [];
  const byId = new Map(checks.map((check) => [check.id, check]));

  if (byId.get("config")?.status === "warn") {
    const text = getLocalizedText();
    recommendations.push("- 新用户优先运行 `qling bootstrap` 完成本机初始化检查。");
    recommendations.push("- 运行 `qling setup` 配置本地 Provider / Model / Endpoint。");
    recommendations.push(`- ${text.boundaries.setupSecret}`);
    recommendations.push(`  ${text.setup.windowsEnvExample}`);
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

  if (byId.get("secrets")?.status === "warn") {
    recommendations.push("- 检测到运行时 .env 中的明文 API key/secret。");
    recommendations.push("  立即在 Provider 控制台轮换密钥。");
    recommendations.push("  将密钥迁移到系统用户环境变量（推荐）或安全的 secret store，删除 .env 中的对应行。");
    recommendations.push("  运行 `qling doctor` 再次确认。");
  }

  if (byId.get("ollama")?.status === "warn") {
    recommendations.push("- 本机未检测到 Ollama。若要用本地模型：安装并启动 Ollama，然后 `/model use ollama` 或 `qling setup` 选本地部署。");
    recommendations.push("  默认探测 http://127.0.0.1:11434 ；可用环境变量 QLING_OLLAMA_URL 覆盖。");
  }
  if (byId.get("ollama")?.status === "pass") {
    recommendations.push("- 已检测到本机 Ollama。可用 `/model use ollama` 切换到本地模型（无需 API key）。");
  }

  // P4: channel connectors (完善 Telegram/Slack，规划其他)
  const hasTelegram = !!process.env.QLING_CHANNEL_TELEGRAM_TOKEN;
  const hasSlack = !!process.env.QLING_CHANNEL_SLACK_BOT_TOKEN;
  const hasFeishu = !!process.env.QLING_CHANNEL_FEISHU_APP_ID;
  if (hasTelegram) {
    checks.push({ id: "channel_telegram", label: "channel:telegram", status: "pass", detail: "Telegram token 已设置" });
    recommendations.push("- Telegram 已配置。使用 /connect telegram test 或 doctor 验证。");
  }
  if (hasSlack) {
    checks.push({ id: "channel_slack", label: "channel:slack", status: "pass", detail: "Slack bot token 已设置" });
    recommendations.push("- Slack 已配置。使用 /connect slack test 验证。");
  }
  if (hasTelegram || hasSlack || hasFeishu) {
    recommendations.push("  常见失败: token 无效/权限不足/网络。运行 /connect <平台> guide 获取向导。");
  }
  if (!hasTelegram && !hasSlack && !hasFeishu) {
    recommendations.push("- 未配置国内 IM 连接器。使用 /connect telegram guide 等获取中文准备向导。");
    recommendations.push("  优先完善 Telegram/Slack，Feishu/DingTalk/WeChat 规划中。");
  }
  // 敏感检查已在 secrets 中
  recommendations.push("- 敏感 token: 绝不写入 .env，复用 scanner + doctor 警告。");

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

const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434/api/tags";

async function probeOllama(env: DoctorOptions["env"]): Promise<{ ok: boolean; detail: string }> {
  const raw = envText(env, "QLING_OLLAMA_URL") || DEFAULT_OLLAMA_URL;
  let url = raw;
  try {
    const parsed = new URL(raw);
    // 允许用户只给 base；自动补 /api/tags
    if (!parsed.pathname || parsed.pathname === "/") {
      parsed.pathname = "/api/tags";
      url = parsed.toString();
    }
  } catch {
    return { ok: false, detail: `无效 QLING_OLLAMA_URL: ${raw}` };
  }

  if (!isLoopbackUrl(url)) {
    return { ok: false, detail: "跳过：Ollama URL 不是本机 loopback。doctor 不会探测公网。" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 800);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      return { ok: false, detail: `${url} HTTP ${response.status}` };
    }
    let modelHint = "";
    try {
      const body = (await response.json()) as { models?: Array<{ name?: string }> };
      const names = (body.models ?? []).map((m) => m.name).filter(Boolean) as string[];
      if (names.length > 0) {
        modelHint = ` models=${names.slice(0, 5).join(",")}${names.length > 5 ? "…" : ""}`;
      } else {
        modelHint = " models=(empty — 可 ollama pull llama3)";
      }
    } catch {
      modelHint = "";
    }
    return { ok: true, detail: `${url} reachable${modelHint}` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, detail: `unreachable: ${msg}` };
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
  const ollama = options.ollamaProbe ? await options.ollamaProbe() : await probeOllama(env);
  const secretsCheck = await buildSecretsCheck();

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
    secretsCheck,
    buildMcpCheck(env),
    buildHooksCheck(env),
    // P4 connectors
    {
      id: "channel_telegram",
      label: "channel:telegram",
      status: !!env.QLING_CHANNEL_TELEGRAM_TOKEN ? "pass" : "warn",
      detail: env.QLING_CHANNEL_TELEGRAM_TOKEN ? "token 已设置" : "未设置 QLING_CHANNEL_TELEGRAM_TOKEN",
    },
    {
      id: "channel_slack",
      label: "channel:slack",
      status: !!env.QLING_CHANNEL_SLACK_BOT_TOKEN ? "pass" : "warn",
      detail: env.QLING_CHANNEL_SLACK_BOT_TOKEN ? "bot token 已设置" : "未设置 Slack token",
    },
    {
      id: "daemon",
      label: "qlingd",
      status: daemon.ok ? "pass" : "warn",
      detail: daemon.detail,
    },
    {
      id: "ollama",
      label: "ollama",
      status: ollama.ok ? "pass" : "warn",
      detail: ollama.detail,
    },
    ...buildPhase3FeatureChecks(env),
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
  const t = getLocalizedText();
  const doctorTitle = t.doctor?.title || "Doctor - 本地环境诊断";
  const lines = [
    "",
    `🩺 ${t.product.name} ${doctorTitle}`,
    "-----------------------------------------",
    `${t.doctor?.summary || "诊断摘要"}: pass=${report.summary.pass} warn=${report.summary.warn} fail=${report.summary.fail}`,
  ];
  for (const check of report.checks) {
    lines.push(`[${icon(check.status)}] ${check.label}: ${check.detail}`);
  }
  if (report.recommendations.length > 0) {
    lines.push("");
    lines.push(t.doctor?.recommendations || "建议");
    lines.push(...report.recommendations);
  }
  lines.push("-----------------------------------------");
  lines.push("说明: Doctor 只读取本地状态与本机 loopback，不上传诊断数据。");
  lines.push("");
  return lines;
}
