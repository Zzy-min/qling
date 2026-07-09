import type { QlingConfig } from "./config.js";
import { formatPermissionMode } from "./statusline.js";

export interface LocalConfigReport {
  provider: string;
  model: string;
  endpoint: string;
  apiKeyStatus: "missing" | "set(redacted)";
  workspaceDir: string;
  stateDir: string;
  cacheDir: string;
  maxSteps: number;
  permissionMode: string;
  permissionRuleCount: number;
  features: Record<string, boolean>;
  logging: {
    level: string;
    format: string;
    inspectPrompt: boolean;
    inspectRequest: boolean;
  };
  isolation: {
    mode: string;
    requireGit: boolean;
    nonGitPolicy: string;
  };
  mcp: {
    total: number;
    enabled: number;
  };
  channelDefault: string;
}

function safeText(value: unknown, fallback = "-"): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function redactQueryLikeSecrets(value: string): string {
  return value.replace(
    /([?&](?:api_?key|key|token|secret|password)=)[^&#\s]*/gi,
    "$1<redacted>"
  );
}

export function sanitizeEndpoint(value: string | null | undefined): string {
  const raw = safeText(value, "");
  if (!raw) return "-";

  if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(raw)) {
    try {
      const url = new URL(raw);
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      return url.toString().replace(/\/$/, url.pathname === "/" ? "/" : "");
    } catch {
      return redactQueryLikeSecrets(raw);
    }
  }

  return redactQueryLikeSecrets(raw);
}

function countEnabledMcpServers(config: QlingConfig): { total: number; enabled: number } {
  const servers = Object.values(config.mcp?.servers ?? {});
  return {
    total: servers.length,
    enabled: servers.filter((server) => server?.enabled).length,
  };
}

export function buildLocalConfigReport(config: QlingConfig): LocalConfigReport {
  const mcp = countEnabledMcpServers(config);
  return {
    provider: safeText(config.llm.provider),
    model: safeText(config.llm.model),
    endpoint: sanitizeEndpoint(config.llm.endpoint),
    apiKeyStatus: safeText(config.llm.api_key, "") ? "set(redacted)" : "missing",
    workspaceDir: safeText(config.runtime.workspace_dir, "-"),
    stateDir: safeText(config.runtime.file_state_dir),
    cacheDir: safeText(config.runtime.file_cache_dir),
    maxSteps: Number(config.runtime.max_steps ?? 0),

    permissionMode: safeText(config.guard.permissions.default, "allow"),
    permissionRuleCount: config.guard.permissions.rules?.length ?? 0,
    features: {
      semantic_memory: Boolean(config.features.semantic_memory),
      workflow_runtime: Boolean(config.features.workflow_runtime),
      vision_tool: Boolean(config.features.vision_tool),
      dashboard: Boolean(config.features.dashboard),
      dynamic_discovery: Boolean(config.features.dynamic_discovery),
      tool_spec_boost: Boolean(config.features.tool_spec_boost),
    },
    logging: {
      level: safeText(config.logging.level),
      format: safeText(config.logging.format),
      inspectPrompt: Boolean(config.logging.inspect_prompt),
      inspectRequest: Boolean(config.logging.inspect_request),
    },
    isolation: {
      mode: safeText(config.agents.isolation.mode),
      requireGit: Boolean(config.agents.isolation.require_git),
      nonGitPolicy: safeText(config.agents.isolation.non_git_policy),
    },
    mcp,
    channelDefault: safeText(config.channels.default),
  };
}

function formatFeatureFlags(features: Record<string, boolean>): string {
  return Object.entries(features)
    .map(([name, enabled]) => `${name}=${enabled ? "on" : "off"}`)
    .join(" ");
}

export function formatLocalConfigReport(report: LocalConfigReport): string[] {
  return [
    "",
    "⚙️ 本地配置摘要",
    "-----------------------------------------",
    `Provider   : ${report.provider}`,
    `Model      : ${report.model}`,
    `Endpoint   : ${report.endpoint}`,
    `Api key    : ${report.apiKeyStatus}`,
    `Workspace  : ${report.workspaceDir}`,
    `State dir  : ${report.stateDir}`,
    `Cache dir  : ${report.cacheDir}`,
    `Runtime    : max_steps=${report.maxSteps}`,
    `Permissions: ${formatPermissionMode(report.permissionMode)}`,
    `Rules      : ${report.permissionRuleCount}`,
    `Features   : ${formatFeatureFlags(report.features)}`,
    `Logging    : level=${report.logging.level} format=${report.logging.format} inspect_prompt=${report.logging.inspectPrompt} inspect_request=${report.logging.inspectRequest}`,
    `Isolation  : mode=${report.isolation.mode} require_git=${report.isolation.requireGit} non_git=${report.isolation.nonGitPolicy}`,
    `MCP        : enabled=${report.mcp.enabled}/${report.mcp.total}`,
    `Channel    : ${report.channelDefault}`,
    "-----------------------------------------",
    "边界      : 只读取当前本地配置；不修改配置、不调用模型、不联网；密钥始终脱敏。",
    "",
  ];
}
