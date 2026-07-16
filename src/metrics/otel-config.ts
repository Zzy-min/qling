export type OtelExportState = "off" | "armed" | "enabled" | "invalid";

export interface OtelExportConfig {
  state: OtelExportState;
  endpoint?: string;
  displayEndpoint: string;
  headers: Record<string, string>;
  timeoutMs: number;
  batchDelayMs: number;
  reason: string;
}

type Environment = NodeJS.ProcessEnv | Record<string, string | undefined>;

function text(env: Environment, name: string): string {
  const value = env[name];
  return typeof value === "string" ? value.trim() : "";
}

function flag(env: Environment, name: string): boolean {
  return /^(1|true|yes|on)$/i.test(text(env, name));
}

function boundedNumber(raw: string, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
}

function parseHeaders(raw: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const item of raw.split(",")) {
    const separator = item.indexOf("=");
    if (separator <= 0) continue;
    const key = item.slice(0, separator).trim().toLowerCase();
    const value = item.slice(separator + 1).trim();
    if (!/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(key)) continue;
    if (key === "host" || key === "content-length" || /[\r\n]/.test(value)) continue;
    try {
      headers[key] = decodeURIComponent(value);
    } catch {
      headers[key] = value;
    }
  }
  return headers;
}

function resolveEndpoint(env: Environment): { raw: string; appendTracePath: boolean } {
  const qling = text(env, "QLING_METRICS_OTEL_ENDPOINT");
  if (qling) return { raw: qling, appendTracePath: false };
  const traces = text(env, "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT");
  if (traces) return { raw: traces, appendTracePath: false };
  return { raw: text(env, "OTEL_EXPORTER_OTLP_ENDPOINT"), appendTracePath: true };
}

function validateEndpoint(raw: string, appendTracePath: boolean): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password || url.search || url.hash) return null;
    if (appendTracePath) {
      url.pathname = `${url.pathname.replace(/\/$/, "")}/v1/traces`.replace(/\/+/g, "/");
    }
    return url;
  } catch {
    return null;
  }
}

export function resolveOtelExportConfig(env: Environment = process.env): OtelExportConfig {
  const enabled = flag(env, "QLING_METRICS_OTEL_ENABLED");
  const confirmed = text(env, "QLING_OTEL_EXPORT_CONFIRM") === "metadata-only";
  const timeoutMs = boundedNumber(text(env, "QLING_METRICS_OTEL_TIMEOUT_MS"), 3000, 500, 10000);
  const batchDelayMs = boundedNumber(text(env, "QLING_METRICS_OTEL_BATCH_DELAY_MS"), 250, 50, 5000);
  const base = {
    displayEndpoint: "-",
    headers: {},
    timeoutMs,
    batchDelayMs,
  };

  if (!enabled) return { ...base, state: "off", reason: "external export is disabled" };
  if (!confirmed) {
    return { ...base, state: "armed", reason: "metadata-only confirmation is missing" };
  }

  const candidate = resolveEndpoint(env);
  if (!candidate.raw) {
    return { ...base, state: "invalid", reason: "OTLP trace endpoint is missing" };
  }
  const endpoint = validateEndpoint(candidate.raw, candidate.appendTracePath);
  if (!endpoint) {
    return { ...base, state: "invalid", reason: "OTLP trace endpoint is invalid" };
  }

  const headerText = text(env, "OTEL_EXPORTER_OTLP_TRACES_HEADERS")
    || text(env, "OTEL_EXPORTER_OTLP_HEADERS");
  return {
    state: "enabled",
    endpoint: endpoint.toString(),
    displayEndpoint: endpoint.origin,
    headers: parseHeaders(headerText),
    timeoutMs,
    batchDelayMs,
    reason: "metadata-only export is enabled",
  };
}
