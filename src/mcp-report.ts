import type { QlingConfig } from "./config.js";

type McpConfig = QlingConfig["mcp"];

export interface LocalMcpServerReport {
  name: string;
  enabled: boolean;
  transport: string;
  command: string;
  args: string[];
  url: string;
  env: Array<{ key: string; status: "set(redacted)" }>;
  headers: Array<{ key: string; status: "set(redacted)" }>;
}

export interface LocalMcpReport {
  total: number;
  enabled: number;
  connectionTimeoutMs: number;
  callTimeoutMs: number;
  servers: LocalMcpServerReport[];
}

function safeText(value: unknown, fallback = "-"): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function redactQueryLikeSecrets(value: string): string {
  return value.replace(
    /([?&](?:api_?key|key|token|secret|password|authorization)=)[^&#\s]*/gi,
    "$1<redacted>"
  );
}

export function sanitizeMcpUrl(value: string | null | undefined): string {
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

function redactKeyMap(values: Record<string, string> | undefined): Array<{ key: string; status: "set(redacted)" }> {
  return Object.keys(values ?? {})
    .sort((left, right) => left.localeCompare(right))
    .map((key) => ({ key, status: "set(redacted)" as const }));
}

function parseEnvServers(raw: string | undefined): McpConfig["servers"] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as McpConfig["servers"];
    }
  } catch {
    return null;
  }
  return null;
}

export function buildLocalMcpReport(
  config: McpConfig,
  env: Record<string, string | undefined> = {}
): LocalMcpReport {
  const envServers = parseEnvServers(env.QLING_MCP_SERVERS);
  const serversConfig = envServers ?? config.servers ?? {};
  const serverEntries = Object.entries(serversConfig);
  const servers = serverEntries
    .map(([name, server]) => ({
      name,
      enabled: Boolean(server.enabled),
      transport: safeText(server.transport, server.url ? "http" : "stdio"),
      command: safeText(server.command, "-"),
      args: Array.isArray(server.args) ? server.args.map(String) : [],
      url: sanitizeMcpUrl(server.url),
      env: redactKeyMap(server.env),
      headers: redactKeyMap(server.headers),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    total: servers.length,
    enabled: servers.filter((server) => server.enabled).length,
    connectionTimeoutMs: Number(config.connection_timeout_ms ?? 0),
    callTimeoutMs: Number(config.call_timeout_ms ?? 0),
    servers,
  };
}

function formatKeyStatuses(values: Array<{ key: string; status: string }>): string {
  if (values.length === 0) return "-";
  return values.map((item) => `${item.key}=${item.status}`).join(", ");
}

export function formatLocalMcpReport(report: LocalMcpReport): string[] {
  const lines = [
    "",
    "🔌 本地 MCP 配置",
    "-----------------------------------------",
    `Servers   : enabled=${report.enabled}/${report.total}`,
    `Timeouts  : connect=${report.connectionTimeoutMs}ms call=${report.callTimeoutMs}ms`,
    "",
  ];

  if (report.servers.length === 0) {
    lines.push("(无 MCP server)");
  } else {
    report.servers.forEach((server, index) => {
      lines.push(`${index + 1}. ${server.name} | enabled=${server.enabled} | transport=${server.transport}`);
      if (server.transport === "http") {
        lines.push(`   url=${server.url}`);
      } else {
        lines.push(`   command=${server.command}`);
        lines.push(`   args=${server.args.length ? server.args.join(" ") : "-"}`);
      }
      lines.push(`   env=${formatKeyStatuses(server.env)}`);
      lines.push(`   headers=${formatKeyStatuses(server.headers)}`);
    });
  }

  lines.push("-----------------------------------------");
  lines.push("边界      : 只读取当前本地 MCP 配置；不连接 server、不启动子进程、不调用模型、不联网；env/header 值始终脱敏。");
  lines.push("");
  return lines;
}
