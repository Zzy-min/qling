import { readdir } from "fs/promises";
import { join } from "path";
import type { QlingConfig } from "./config.js";
import { sanitizeEndpoint } from "./config-report.js";
import { buildLocalHooksReport } from "./hooks-report.js";
import { buildLocalMcpReport } from "./mcp-report.js";
import { resolveGitBranch } from "./statusline.js";

export interface LocalStatusReport {
  provider: string;
  model: string;
  endpoint: string;
  apiKeyStatus: "missing" | "set(redacted)";
  workspaceDir: string;
  stateDir: string;
  cacheDir: string;
  branch: string;
  sessionsCount: number;
  exportsCount: number;
  permissionMode: string;
  mcpEnabled: number;
  mcpTotal: number;
  hooksEnabled: boolean;
}

export interface LocalStatusOptions {
  gitBranch?: (workspaceDir?: string) => string | null;
}

function safeText(value: unknown, fallback = "-"): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

async function countFilesByExtension(dir: string, extension: string): Promise<number> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(extension)).length;
  } catch {
    return 0;
  }
}

export async function buildLocalStatusReport(
  config: QlingConfig,
  options: LocalStatusOptions = {}
): Promise<LocalStatusReport> {
  const workspaceDir = safeText(config.runtime.workspace_dir, process.cwd());
  const stateDir = safeText(config.runtime.file_state_dir);
  const cacheDir = safeText(config.runtime.file_cache_dir);
  const branch = (options.gitBranch ?? resolveGitBranch)(workspaceDir);
  const mcp = buildLocalMcpReport(config.mcp);
  const hooks = buildLocalHooksReport(config.guard);

  const [sessionsCount, exportsCount] = await Promise.all([
    countFilesByExtension(join(stateDir, "sessions"), ".json"),
    countFilesByExtension(join(stateDir, "exports"), ".md"),
  ]);

  return {
    provider: safeText(config.llm.provider),
    model: safeText(config.llm.model),
    endpoint: sanitizeEndpoint(config.llm.endpoint),
    apiKeyStatus: safeText(config.llm.api_key, "") ? "set(redacted)" : "missing",
    workspaceDir,
    stateDir,
    cacheDir,
    branch: branch ?? "-",
    sessionsCount,
    exportsCount,
    permissionMode: safeText(config.guard.permissions.default, "allow"),
    mcpEnabled: mcp.enabled,
    mcpTotal: mcp.total,
    hooksEnabled: hooks.guardEnabled,
  };
}

export function formatLocalStatusReport(report: LocalStatusReport): string[] {
  return [
    "",
    "📍 本地状态",
    "-----------------------------------------",
    `Runtime   : provider=${report.provider} model=${report.model} endpoint=${report.endpoint} api_key=${report.apiKeyStatus}`,
    `Workspace : ${report.workspaceDir}`,
    `State     : ${report.stateDir}`,
    `Cache     : ${report.cacheDir}`,
    `Git       : branch=${report.branch}`,
    `Local data: sessions=${report.sessionsCount} exports=${report.exportsCount}`,
    `Control   : permission=${report.permissionMode} MCP=${report.mcpEnabled}/${report.mcpTotal} hooks=${report.hooksEnabled ? "on" : "off"}`,
    "-----------------------------------------",
    "边界      : 只读取本地配置和文件元数据；不读取会话/导出正文、不连接 MCP、不运行 hooks、不调用模型、不联网、不写配置。",
    "",
  ];
}
