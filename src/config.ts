import { readFile } from "fs/promises";
import { existsSync } from "fs";
import * as os from "os";
import * as path from "path";
import YAML from "yaml";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFormat = "text" | "json";

export interface GuardConfig {
  enabled: boolean;
  network: {
    url_fetch: {
      allowed_url_prefixes: string[];
      deny_private_ips: boolean;
      follow_redirects: boolean;
    };
  };
  redaction: {
    enabled: boolean;
    patterns: string[];
  };
  audit: {
    jsonl_path: string;
  };
  rate_limit: {
    enabled: boolean;
    max_per_minute: number;
  };
  content_filter: {
    enabled: boolean;
    pii_detection: boolean;
    injection_detection: boolean;
    custom_patterns: string[];
  };
  permissions: {
    default: "allow" | "deny" | "ask";
    rules: Array<{
      tool_pattern: string;
      decision: "allow" | "deny" | "ask";
      reason?: string;
    }>;
  };
}

export interface QinglingConfig {
  llm: {
    provider: string;
    model: string;
    endpoint: string;
    api_key: string;
    request_timeout_ms: number;
  };
  runtime: {
    workspace_dir: string | null;
    file_cache_dir: string;
    file_state_dir: string;
    max_steps: number;
    parse_retries: number;
    max_token_budget: number;
    tool_repeat_limit: number;
    timeout_ms: number;
  };
  logging: {
    level: LogLevel;
    format: LogFormat;
    inspect_prompt: boolean;
    inspect_request: boolean;
    inspect_dump_dir: string;
  };
  tools: Record<string, { enabled: boolean }>;
  memory: {
    wal_enabled: boolean;
    projection_interval_ms: number;
    dream_llm_enabled: boolean;
    dream_turn_threshold: number;
    max_memories: number;
  };
  guard: GuardConfig;
  mcp: {
    servers: Record<string, {
      command: string;
      args: string[];
      env?: Record<string, string>;
      enabled: boolean;
      transport?: "stdio" | "http";
      url?: string;
      headers?: Record<string, string>;
    }>;
    connection_timeout_ms: number;
    call_timeout_ms: number;
  };
  metrics: {
    enabled: boolean;
    dir: string;
    flush_interval_ms: number;
    retention_days: number;
  };
  channels: {
    default: string;
    telegram: {
      token: string;
      poll_interval_ms: number;
      allowed_chat_ids: string[];
    };
    slack: {
      bot_token: string;
      app_token: string;
      channel_ids: string[];
      poll_interval_ms: number;
    };
  };
  routes: {
    main_loop: {
      profile: string;
      fallback_profiles: string[];
    };
    plan_create: {
      profile: string;
      fallback_profiles: string[];
    };
    verify: {
      profile: string;
      fallback_profiles: string[];
    };
  };
}

export interface CliGlobalOptions {
  configPath?: string;
  workspaceDir?: string;
  noWorkspace?: boolean;
  fileCacheDir?: string;
  fileStateDir?: string;
  inspectPrompt?: boolean;
  inspectRequest?: boolean;
  logFormat?: LogFormat;
  logLevel?: LogLevel;
  model?: string;
  provider?: string;
  endpoint?: string;
  apiKey?: string;
}

export interface LoadedConfig {
  config: QinglingConfig;
  warnings: string[];
  usedConfigPath?: string;
}

const HOME = os.homedir();
const DEFAULT_STATE_DIR = path.join(HOME, ".qingling");
const DEFAULT_CACHE_DIR = path.join(DEFAULT_STATE_DIR, "cache");

export function buildDefaultConfig(): QinglingConfig {
  return {
    llm: {
      provider: "deepseek",
      model: "deepseek-chat",
      endpoint: "https://api.deepseek.com",
      api_key: "",
      request_timeout_ms: 120000,
    },
    runtime: {
      workspace_dir: process.cwd(),
      file_cache_dir: DEFAULT_CACHE_DIR,
      file_state_dir: DEFAULT_STATE_DIR,
      max_steps: 50,
      parse_retries: 2,
      max_token_budget: 120000,
      tool_repeat_limit: 6,
      timeout_ms: 300000,
    },
    logging: {
      level: "info",
      format: "text",
      inspect_prompt: false,
      inspect_request: false,
      inspect_dump_dir: path.join(DEFAULT_STATE_DIR, "dump"),
    },
    tools: {
      bash: { enabled: true },
      read: { enabled: true },
      write: { enabled: true },
      todo: { enabled: true },
      skill: { enabled: true },
      search: { enabled: true },
      planner: { enabled: true },
      url_fetch: { enabled: true },
    },
    memory: {
      wal_enabled: true,
      projection_interval_ms: 5000,
      dream_llm_enabled: true,
      dream_turn_threshold: 24,
      max_memories: 1000,
    },
    guard: {
      enabled: true,
      network: {
        url_fetch: {
          allowed_url_prefixes: ["https://"],
          deny_private_ips: true,
          follow_redirects: false,
        },
      },
      redaction: {
        enabled: true,
        patterns: [],
      },
      audit: {
        jsonl_path: path.join(DEFAULT_STATE_DIR, "guard", "audit", "guard_audit.jsonl"),
      },
      rate_limit: {
        enabled: false,
        max_per_minute: 30,
      },
      content_filter: {
        enabled: false,
        pii_detection: true,
        injection_detection: true,
        custom_patterns: [],
      },
      permissions: {
        default: "allow" as const,
        rules: [],
      },
    },
    mcp: {
      servers: {},
      connection_timeout_ms: 10000,
      call_timeout_ms: 30000,
    },
    metrics: {
      enabled: false,
      dir: path.join(DEFAULT_STATE_DIR, "metrics"),
      flush_interval_ms: 10000,
      retention_days: 30,
    },
    channels: {
      default: "console",
      telegram: {
        token: "",
        poll_interval_ms: 3000,
        allowed_chat_ids: [],
      },
      slack: {
        bot_token: "",
        app_token: "",
        channel_ids: [],
        poll_interval_ms: 3000,
      },
    },
    routes: {
      main_loop: {
        profile: "default",
        fallback_profiles: [],
      },
      plan_create: {
        profile: "default",
        fallback_profiles: ["default"],
      },
      verify: {
        profile: "default",
        fallback_profiles: ["default"],
      },
    },
  };
}

export async function loadQinglingConfig(
  cli: CliGlobalOptions,
  env: NodeJS.ProcessEnv = process.env
): Promise<LoadedConfig> {
  const warnings: string[] = [];
  const defaults = buildDefaultConfig();
  let fromFile: Partial<QinglingConfig> = {};
  let usedConfigPath: string | undefined;

  const configPath = resolveConfigPath(cli.configPath);
  if (cli.configPath && configPath && !existsSync(configPath)) {
    throw new Error(`config file not found: ${configPath}`);
  }
  if (configPath && existsSync(configPath)) {
    const raw = await readFile(configPath, "utf-8");
    const expanded = expandEnvTemplate(raw, env, warnings);
    fromFile = parseConfigByExt(configPath, expanded) as Partial<QinglingConfig>;
    usedConfigPath = configPath;
  }

  const fromEnv = buildEnvConfig(env, defaults);
  const merged = deepMerge(deepMerge(defaults, fromFile), fromEnv);
  const withCli = applyCliOverrides(merged, cli);
  normalizeRuntimeRoots(withCli);

  return {
    config: withCli,
    warnings,
    usedConfigPath,
  };
}

export function applyConfigToProcessEnv(config: QinglingConfig): void {
  process.env.QINGLING_LLM_PROVIDER = config.llm.provider;
  process.env.QINGLING_LLM_MODEL = config.llm.model;
  process.env.QINGLING_LLM_ENDPOINT = config.llm.endpoint;
  process.env.QINGLING_LLM_REQUEST_TIMEOUT_MS = String(config.llm.request_timeout_ms);
  if (config.llm.api_key) {
    process.env.QINGLING_LLM_API_KEY = config.llm.api_key;
  }

  if (config.runtime.workspace_dir) {
    process.env.QINGLING_WORKSPACE_DIR = config.runtime.workspace_dir;
  } else {
    delete process.env.QINGLING_WORKSPACE_DIR;
  }
  process.env.QINGLING_FILE_CACHE_DIR = config.runtime.file_cache_dir;
  process.env.QINGLING_FILE_STATE_DIR = config.runtime.file_state_dir;
  process.env.QINGLING_GUARD_ENABLED = String(config.guard.enabled);
  process.env.QINGLING_GUARD_NETWORK_URL_FETCH_ALLOWED_URL_PREFIXES =
    JSON.stringify(config.guard.network.url_fetch.allowed_url_prefixes);
  process.env.QINGLING_GUARD_NETWORK_URL_FETCH_DENY_PRIVATE_IPS = String(
    config.guard.network.url_fetch.deny_private_ips
  );
  process.env.QINGLING_GUARD_NETWORK_URL_FETCH_FOLLOW_REDIRECTS = String(
    config.guard.network.url_fetch.follow_redirects
  );
  process.env.QINGLING_GUARD_REDACTION_ENABLED = String(config.guard.redaction.enabled);
  process.env.QINGLING_GUARD_REDACTION_PATTERNS = JSON.stringify(config.guard.redaction.patterns);
  process.env.QINGLING_GUARD_AUDIT_JSONL_PATH = config.guard.audit.jsonl_path;

  // Memory (Phase 3)
  process.env.QINGLING_MEMORY_WAL_ENABLED = String(config.memory.wal_enabled);
  process.env.QINGLING_MEMORY_PROJECTION_INTERVAL_MS = String(config.memory.projection_interval_ms);
  process.env.QINGLING_MEMORY_DREAM_LLM_ENABLED = String(config.memory.dream_llm_enabled);
  process.env.QINGLING_MEMORY_DREAM_TURN_THRESHOLD = String(config.memory.dream_turn_threshold);
  process.env.QINGLING_MEMORY_MAX_MEMORIES = String(config.memory.max_memories);

  // MCP (Phase 4)
  process.env.QINGLING_MCP_SERVERS = JSON.stringify(config.mcp.servers);
  process.env.QINGLING_MCP_CONNECTION_TIMEOUT_MS = String(config.mcp.connection_timeout_ms);
  process.env.QINGLING_MCP_CALL_TIMEOUT_MS = String(config.mcp.call_timeout_ms);

  // Metrics (Phase 5)
  process.env.QINGLING_METRICS_ENABLED = String(config.metrics.enabled);
  process.env.QINGLING_METRICS_DIR = config.metrics.dir;
  process.env.QINGLING_METRICS_FLUSH_INTERVAL_MS = String(config.metrics.flush_interval_ms);
  process.env.QINGLING_METRICS_RETENTION_DAYS = String(config.metrics.retention_days);

  // Channels (Phase 5)
  process.env.QINGLING_CHANNEL_DEFAULT = config.channels.default;
  process.env.QINGLING_CHANNEL_TELEGRAM_TOKEN = config.channels.telegram.token;
  process.env.QINGLING_CHANNEL_TELEGRAM_POLL_INTERVAL_MS = String(
    config.channels.telegram.poll_interval_ms
  );
  process.env.QINGLING_CHANNEL_TELEGRAM_ALLOWED_CHAT_IDS = JSON.stringify(
    config.channels.telegram.allowed_chat_ids
  );
  process.env.QINGLING_CHANNEL_SLACK_BOT_TOKEN = config.channels.slack.bot_token;
  process.env.QINGLING_CHANNEL_SLACK_APP_TOKEN = config.channels.slack.app_token;
  process.env.QINGLING_CHANNEL_SLACK_CHANNEL_IDS = JSON.stringify(config.channels.slack.channel_ids);
  process.env.QINGLING_CHANNEL_SLACK_POLL_INTERVAL_MS = String(
    config.channels.slack.poll_interval_ms
  );
}

export function guardConfigFromEnv(env: NodeJS.ProcessEnv = process.env): GuardConfig {
  const defaults = buildDefaultConfig().guard;
  const prefixes = parseStringArray(
    env.QINGLING_GUARD_NETWORK_URL_FETCH_ALLOWED_URL_PREFIXES,
    defaults.network.url_fetch.allowed_url_prefixes
  );
  const redactionPatterns = parseStringArray(
    env.QINGLING_GUARD_REDACTION_PATTERNS,
    defaults.redaction.patterns
  );

  return {
    enabled: parseBoolean(env.QINGLING_GUARD_ENABLED, defaults.enabled),
    network: {
      url_fetch: {
        allowed_url_prefixes: prefixes,
        deny_private_ips: parseBoolean(
          env.QINGLING_GUARD_NETWORK_URL_FETCH_DENY_PRIVATE_IPS,
          defaults.network.url_fetch.deny_private_ips
        ),
        follow_redirects: parseBoolean(
          env.QINGLING_GUARD_NETWORK_URL_FETCH_FOLLOW_REDIRECTS,
          defaults.network.url_fetch.follow_redirects
        ),
      },
    },
    redaction: {
      enabled: parseBoolean(env.QINGLING_GUARD_REDACTION_ENABLED, defaults.redaction.enabled),
      patterns: redactionPatterns,
    },
    audit: {
      jsonl_path: env.QINGLING_GUARD_AUDIT_JSONL_PATH ?? defaults.audit.jsonl_path,
    },
    rate_limit: {
      enabled: parseBoolean(env.QINGLING_GUARD_RATE_LIMIT_ENABLED, defaults.rate_limit.enabled),
      max_per_minute: parseNumber(env.QINGLING_GUARD_RATE_LIMIT_MAX_PER_MINUTE, defaults.rate_limit.max_per_minute),
    },
    content_filter: {
      enabled: parseBoolean(env.QINGLING_GUARD_CONTENT_FILTER_ENABLED, defaults.content_filter.enabled),
      pii_detection: parseBoolean(env.QINGLING_GUARD_CONTENT_FILTER_PII, defaults.content_filter.pii_detection),
      injection_detection: parseBoolean(env.QINGLING_GUARD_CONTENT_FILTER_INJECTION, defaults.content_filter.injection_detection),
      custom_patterns: parseStringArray(env.QINGLING_GUARD_CONTENT_FILTER_CUSTOM, defaults.content_filter.custom_patterns),
    },
    permissions: {
      default: (env.QINGLING_GUARD_PERMISSIONS_DEFAULT ?? defaults.permissions.default) as "allow" | "deny" | "ask",
      rules: parsePermissionRules(env.QINGLING_GUARD_PERMISSIONS_RULES, defaults.permissions.rules),
    },
  };
}

function resolveConfigPath(input?: string): string | undefined {
  if (input && input.trim()) {
    return path.resolve(input.trim());
  }
  const candidates = ["qingling.config.yaml", "qingling.config.yml", "qingling.config.json"];
  for (const p of candidates) {
    const abs = path.resolve(process.cwd(), p);
    if (existsSync(abs)) return abs;
  }
  return undefined;
}

function parseConfigByExt(filePath: string, raw: string): unknown {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".yaml" || ext === ".yml") {
    return YAML.parse(raw) ?? {};
  }
  return JSON.parse(raw);
}

function expandEnvTemplate(raw: string, env: NodeJS.ProcessEnv, warnings: string[]): string {
  return raw.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, name: string) => {
    const val = env[name];
    if (val === undefined) {
      warnings.push(`Missing env variable in config template: ${name}`);
      return "";
    }
    return val;
  });
}

function buildEnvConfig(env: NodeJS.ProcessEnv, defaults: QinglingConfig): Partial<QinglingConfig> {
  const flatDefaults = flattenObject(defaults);
  const acc: Record<string, unknown> = {};
  for (const [key, defaultValue] of Object.entries(flatDefaults)) {
    const envName = toQinglingEnvName(key);
    const raw = env[envName];
    if (raw === undefined) continue;
    setByPath(acc, key, parseEnvValue(raw, defaultValue));
  }
  return acc as Partial<QinglingConfig>;
}

function toQinglingEnvName(keyPath: string): string {
  return `QINGLING_${keyPath.replace(/[.-]/g, "_").toUpperCase()}`;
}

function parseEnvValue(raw: string, defaultValue: unknown): unknown {
  if (typeof defaultValue === "boolean") {
    return /^(1|true|yes|on)$/i.test(raw.trim());
  }
  if (typeof defaultValue === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : defaultValue;
  }
  if (Array.isArray(defaultValue)) {
    const trimmed = raw.trim();
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : defaultValue;
      } catch {
        return defaultValue;
      }
    }
    return trimmed
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  }
  if (typeof defaultValue === "object" && defaultValue !== null) {
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === "object" && parsed !== null ? parsed : defaultValue;
    } catch {
      return defaultValue;
    }
  }
  return raw;
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

function parseNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function parsePermissionRules(
  raw: string | undefined,
  fallback: Array<{ tool_pattern: string; decision: "allow" | "deny" | "ask"; reason?: string }>
): Array<{ tool_pattern: string; decision: "allow" | "deny" | "ask"; reason?: string }> {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (r) =>
          typeof r === "object" &&
          typeof r.tool_pattern === "string" &&
          ["allow", "deny", "ask"].includes(r.decision)
      );
    }
  } catch {
    // ignore
  }
  return fallback;
}

function parseStringArray(raw: string | undefined, fallback: string[]): string[] {
  if (!raw) return fallback;
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((v) => String(v)).filter(Boolean);
      }
    } catch {
      return fallback;
    }
  }
  return trimmed
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function applyCliOverrides(config: QinglingConfig, cli: CliGlobalOptions): QinglingConfig {
  const next = deepClone(config);
  if (cli.workspaceDir) next.runtime.workspace_dir = path.resolve(cli.workspaceDir);
  if (cli.noWorkspace) next.runtime.workspace_dir = null;
  if (cli.fileCacheDir) next.runtime.file_cache_dir = path.resolve(cli.fileCacheDir);
  if (cli.fileStateDir) next.runtime.file_state_dir = path.resolve(cli.fileStateDir);
  if (cli.inspectPrompt !== undefined) next.logging.inspect_prompt = cli.inspectPrompt;
  if (cli.inspectRequest !== undefined) next.logging.inspect_request = cli.inspectRequest;
  if (cli.logFormat) next.logging.format = cli.logFormat;
  if (cli.logLevel) next.logging.level = cli.logLevel;
  if (cli.model) next.llm.model = cli.model;
  if (cli.provider) next.llm.provider = cli.provider;
  if (cli.endpoint) next.llm.endpoint = cli.endpoint;
  if (cli.apiKey) next.llm.api_key = cli.apiKey;
  return next;
}

function normalizeRuntimeRoots(config: QinglingConfig): void {
  config.runtime.file_state_dir = path.resolve(config.runtime.file_state_dir);
  config.runtime.file_cache_dir = path.resolve(config.runtime.file_cache_dir);
  if (config.runtime.workspace_dir) {
    config.runtime.workspace_dir = path.resolve(config.runtime.workspace_dir);
  }
  if (!config.runtime.file_cache_dir.startsWith(config.runtime.file_state_dir)) {
    config.runtime.file_cache_dir = path.join(config.runtime.file_state_dir, "cache");
  }
}

function flattenObject(input: unknown, parent = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    if (parent) out[parent] = input;
    return out;
  }
  const obj = input as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    const key = parent ? `${parent}.${k}` : k;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      flattenObject(v, key, out);
    } else {
      out[key] = v;
    }
  }
  return out;
}

function setByPath(target: Record<string, unknown>, keyPath: string, value: unknown): void {
  const parts = keyPath.split(".");
  let cur: Record<string, unknown> = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (typeof cur[p] !== "object" || cur[p] === null || Array.isArray(cur[p])) {
      cur[p] = {};
    }
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

function deepClone<T>(v: T): T {
  return structuredClone(v);
}

function deepMerge<T>(base: T, override: Partial<T>): T {
  if (override === undefined || override === null) return deepClone(base);
  if (typeof base !== "object" || base === null) return deepClone(override as T);
  if (typeof override !== "object" || override === null) return deepClone(override as T);
  if (Array.isArray(base) || Array.isArray(override)) return deepClone(override as T);

  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
    if (v === undefined) continue;
    const cur = out[k];
    if (
      typeof cur === "object" &&
      cur !== null &&
      !Array.isArray(cur) &&
      typeof v === "object" &&
      v !== null &&
      !Array.isArray(v)
    ) {
      out[k] = deepMerge(cur, v as Record<string, unknown>);
    } else {
      out[k] = deepClone(v);
    }
  }
  return out as T;
}
