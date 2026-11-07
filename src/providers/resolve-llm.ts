// Provider-scoped LLM settings. A key is only eligible for its own provider.
import {
  getProviderPreset,
  listProviderPresets,
  lookupModelWindow,
  type ProviderPreset,
} from "./presets.js";
import type { AuthProfile } from "../auth/types.js";

export type LlmFieldSource = "default" | "file" | "env" | "cli" | "preset" | "session";

export interface LlmFieldSources {
  provider: LlmFieldSource;
  endpoint: LlmFieldSource;
  model: LlmFieldSource;
  apiKey: LlmFieldSource;
}

/** Provider id → env var. QLING_LLM_API_KEY is not in this map; it is startup-provider scoped. */
export const PROVIDER_API_KEY_ENV: Record<string, string> = {
  deepseek: "DEEPSEEK_API_KEY",
  openai: "OPENAI_API_KEY",
  xai: "XAI_API_KEY",
  dashscope: "DASHSCOPE_API_KEY",
  moonshot: "MOONSHOT_API_KEY",
  zhipu: "ZHIPU_API_KEY",
  minimax: "MINIMAX_API_KEY",
  mimo: "MIMO_API_KEY",
  siliconflow: "SILICONFLOW_API_KEY",
  mistral: "MISTRAL_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

export interface ResolveProviderApiKeyOptions {
  /** Provider the process booted with. QLING_LLM_API_KEY is eligible only for this provider. */
  startupProvider?: string;
  sessionApiKey?: string;
  sameProvider?: boolean;
  explicitApiKey?: string;
  endpoint?: string;
  currentProvider?: string;
  currentEndpoint?: string;
}

export interface ResolvedProviderApiKey {
  apiKey: string;
  source: LlmFieldSource | "none";
  envVar?: string;
  refused: boolean;
  message?: string;
}

type EnvLike = NodeJS.ProcessEnv | Record<string, string | undefined>;

function normalizeProviderId(provider: string | undefined): string {
  return String(provider ?? "").trim().toLowerCase();
}

/** Full base URL is the credential boundary, including a proxy's routing path. */
export function normalizeLlmEndpoint(endpoint?: string): string {
  try { return new URL(String(endpoint)).href.replace(/\/+$/, ""); }
  catch { return String(endpoint ?? "").trim().replace(/\/+$/, ""); }
}

export function isUsableApiKey(key?: string): boolean {
  const value = String(key ?? "").trim();
  return Boolean(value && value !== "local" && !value.startsWith("qling-auth:"));
}

export function providerApiKeyEnv(provider: string): string | undefined {
  return PROVIDER_API_KEY_ENV[normalizeProviderId(provider)];
}

export function endpointHost(endpoint: string | null | undefined): string {
  const raw = String(endpoint ?? "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).host;
  } catch {
    return "";
  }
}

export function isHttpEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Reject blank or whitespace model ids before they become a 404. */
export function validateModelName(name: string): string | null {
  if (!String(name ?? "").trim()) return "模型名不能为空";
  if (/\s/.test(name)) return "模型名不能包含空格";
  return null;
}

export function resolveProviderApiKey(
  provider: string,
  env: EnvLike = process.env,
  options: ResolveProviderApiKeyOptions = {}
): ResolvedProviderApiKey {
  if (["chatgpt","grok-account"].includes(normalizeProviderId(provider))) {
    return {apiKey:"",source:"none",refused:true,message:"Account mode requires qling login"};
  }
  const explicit = options.explicitApiKey?.trim();
  if (isUsableApiKey(explicit)) {
    return { apiKey: explicit!, source: "cli", refused: false };
  }

  const normalized = normalizeProviderId(provider);
  const preset = getProviderPreset(normalized);
  const keyProvider = normalizeProviderId(preset?.provider || normalized);
  const requiresKey = preset ? preset.requiresApiKey : !["ollama", "local"].includes(keyProvider);

  if (options.sameProvider) {
    const sessionKey = String(options.sessionApiKey ?? "").trim();
    if (isUsableApiKey(sessionKey) && (!options.endpoint ||
      (normalizeProviderId(options.currentProvider ?? provider) === keyProvider &&
       normalizeLlmEndpoint(options.currentEndpoint) === normalizeLlmEndpoint(options.endpoint)))) {
      return { apiKey: sessionKey, source: "session", refused: false };
    }
  }

  const startup = normalizeProviderId(
    options.startupProvider ?? env.QLING_LLM_STARTUP_PROVIDER ?? ""
  );
  const generic = String(env.QLING_LLM_API_KEY ?? "").trim();
  const genericOwnedHere = !startup || startup === keyProvider || startup === normalized;
  const target = options.endpoint ? normalizeLlmEndpoint(options.endpoint) : undefined;
  const scopedEndpoint = providerScopedBaseUrl(keyProvider, env) ||
    ((normalizeProviderId(env.QLING_LLM_STARTUP_PROVIDER ?? env.QLING_LLM_PROVIDER) === keyProvider)
      ? String(env.QLING_LLM_ENDPOINT ?? "") : "");
  const switchingEndpoint = normalizeProviderId(options.currentProvider) === keyProvider &&
    normalizeLlmEndpoint(options.currentEndpoint) !== target;
  const specificOwnedHere = !target || (scopedEndpoint
    ? normalizeLlmEndpoint(scopedEndpoint) === target
    : !switchingEndpoint && normalizeLlmEndpoint(preset?.endpoint) === target);
  const genericEndpointOwned = !target || Boolean(scopedEndpoint && normalizeLlmEndpoint(scopedEndpoint) === target);
  if (isUsableApiKey(generic) && genericOwnedHere && genericEndpointOwned) {
    return { apiKey: generic, source: "env", envVar: "QLING_LLM_API_KEY", refused: false };
  }

  const envVar = providerApiKeyEnv(keyProvider);
  const specific = envVar ? String(env[envVar] ?? "").trim() : "";
  if (isUsableApiKey(specific) && specificOwnedHere) {
    return { apiKey: specific, source: "env", envVar, refused: false };
  }

  if (!requiresKey) {
    return { apiKey: "", source: "none", refused: false };
  }

  const hint = preset?.keyHint || `${keyProvider || "provider"} API Key`;
  const id = preset?.id || keyProvider || "provider";
  const crossProvider = Boolean(startup) && startup !== keyProvider;
  const needed = envVar || (crossProvider ? `${keyProvider.toUpperCase()}_API_KEY` : "QLING_LLM_API_KEY");
  return {
    apiKey: "",
    source: "none",
    envVar: envVar || (crossProvider ? needed : undefined),
    refused: true,
    message: `需要 ${hint}：设置 ${needed} 或 /model use ${id} 后 /login`,
  };
}

export function hasAnyConfiguredApiKey(env: EnvLike): boolean {
  if (String(env.QLING_LLM_API_KEY ?? "").trim()) return true;
  for (const name of Object.values(PROVIDER_API_KEY_ENV)) {
    if (String(env[name] ?? "").trim()) return true;
  }
  return false;
}

export function isSameLlmTarget(
  preset: Pick<ProviderPreset, "provider" | "endpoint" | "model">,
  current: { provider?: string; endpoint?: string; model?: string }
): boolean {
  return (
    normalizeProviderId(preset.provider) === normalizeProviderId(current.provider) &&
    normalizeLlmEndpoint(preset.endpoint) === normalizeLlmEndpoint(current.endpoint) &&
    preset.model === String(current.model ?? "")
  );
}

export function activePresetIds(current: {
  provider?: string;
  endpoint?: string;
  model?: string;
}): string[] {
  return listProviderPresets()
    .filter((preset) => isSameLlmTarget(preset, current))
    .map((preset) => preset.id);
}

function providerScopedBaseUrl(provider: string, env: EnvLike): string {
  const id = normalizeProviderId(provider);
  if (id === "openai" && String(env.OPENAI_BASE_URL ?? "").trim()) {
    return String(env.OPENAI_BASE_URL).trim();
  }
  if (id === "deepseek" && String(env.DEEPSEEK_BASE_URL ?? "").trim()) {
    return String(env.DEEPSEEK_BASE_URL).trim();
  }
  return "";
}

export function endpointProviderConflict(provider: string, endpoint: string): string | null {
  const host = endpointHost(endpoint);
  if (!host) return null;
  const owners = listProviderPresets({ includeAliases: true }).filter(
    (preset) => endpointHost(preset.endpoint) === host
  );
  if (owners.length === 0) return null;
  const normalized = normalizeProviderId(provider);
  const preset = getProviderPreset(normalized);
  const compatible = owners.some(
    (owner) =>
      normalizeProviderId(owner.provider) === normalized ||
      owner.id === normalized ||
      (preset && (owner.provider === preset.provider || owner.id === preset.id))
  );
  if (compatible) return null;
  return `provider=${provider} 与 endpoint 主机 ${host}（属于 ${owners[0].id}）不一致。`;
}

export interface ResolveLlmSettingsInput {
  provider?: string;
  endpoint?: string;
  model?: string;
  apiKey?: string;
  sources?: Partial<LlmFieldSources>;
}

export interface ResolvedLlmSettings {
  provider: string;
  endpoint: string;
  model: string;
  apiKey: string;
  sources: LlmFieldSources;
  warnings: string[];
  contextWindow: number | null;
  windowSource: "config" | "model" | "legacy";
}

function sourceOr(
  explicit: LlmFieldSource | undefined,
  fallback: LlmFieldSource
): LlmFieldSource {
  return explicit ?? fallback;
}

export function resolveLlmSettings(
  input: ResolveLlmSettingsInput = {},
  env: EnvLike = process.env
): ResolvedLlmSettings {
  const warnings: string[] = [];
  const providerInput = input.provider?.trim() || "";
  const endpointInput = input.endpoint?.trim() || "";
  const modelInput = input.model?.trim() || "";
  const apiKeyInput = input.apiKey !== undefined ? String(input.apiKey).trim() : "";

  const sources: LlmFieldSources = {
    provider: sourceOr(
      input.sources?.provider,
      providerInput ? "session" : String(env.QLING_LLM_PROVIDER ?? "").trim() ? "env" : "default"
    ),
    endpoint: sourceOr(
      input.sources?.endpoint,
      endpointInput ? "session" : String(env.QLING_LLM_ENDPOINT ?? "").trim() ? "env" : "default"
    ),
    model: sourceOr(
      input.sources?.model,
      modelInput ? "session" : String(env.QLING_LLM_MODEL ?? "").trim() ? "env" : "default"
    ),
    apiKey: sourceOr(
      input.sources?.apiKey,
      input.apiKey !== undefined && String(input.apiKey).trim() ? "session" : "default"
    ),
  };

  let provider = providerInput || String(env.QLING_LLM_PROVIDER ?? "").trim() || "deepseek";
  let endpoint = endpointInput || String(env.QLING_LLM_ENDPOINT ?? "").trim() || "";
  let model = modelInput || String(env.QLING_LLM_MODEL ?? "").trim() || "";
  let apiKey = input.apiKey !== undefined ? apiKeyInput : "";
  const explicitEmptyKey =
    input.apiKey !== undefined && !apiKeyInput && sources.apiKey !== "default";

  if (!endpoint && sources.endpoint === "default") {
    const scoped = providerScopedBaseUrl(provider, env);
    if (scoped) {
      endpoint = scoped;
      sources.endpoint = "env";
    }
  }

  const preset = getProviderPreset(provider);
  if (!preset) {
    warnings.push(`未知 provider '${provider}'：未套用预设 endpoint/model。`);
  }

  if (preset && sources.provider !== "default") {
    if (!endpoint || sources.endpoint === "default") {
      endpoint = preset.endpoint;
      sources.endpoint = "preset";
    }
    if (!model || sources.model === "default") {
      model = preset.model;
      sources.model = "preset";
    }
  }

  if (!endpoint) {
    endpoint = preset?.endpoint || "https://api.deepseek.com";
  }
  if (!model) {
    model = preset?.model || "deepseek-flash";
  }

  if (!isHttpEndpoint(endpoint)) {
    warnings.push("endpoint 不是 http(s) URL。");
  } else if (sources.endpoint !== "default" && sources.endpoint !== "preset") {
    const conflict = endpointProviderConflict(provider, endpoint);
    if (conflict) warnings.push(conflict);
  }

  if (!apiKey && !explicitEmptyKey) {
    const resolved = resolveProviderApiKey(provider, env, { startupProvider: provider });
    if (resolved.apiKey) {
      apiKey = resolved.apiKey;
      sources.apiKey = resolved.source === "session" ? "session" : "env";
    }
  }

  const known = lookupModelWindow(model);
  return {
    provider,
    endpoint,
    model,
    apiKey,
    sources,
    warnings,
    contextWindow: known?.contextWindow ?? null,
    windowSource: known ? "model" : "legacy",
  };
}

export interface LoadedLlmSlice {
  provider: string;
  endpoint: string;
  model: string;
  api_key: string;
}

/** Fill preset endpoint/model when only the provider was set, and warn on host conflicts. */
export function alignLoadedLlmConfig(
  llm: LoadedLlmSlice,
  sources: LlmFieldSources,
  env: EnvLike,
  warnings: string[]
): void {
  const preset = getProviderPreset(llm.provider);
  if (!preset) {
    warnings.push(`未知 provider '${llm.provider}'：未套用预设 endpoint/model。`);
  }
  if (preset && sources.provider !== "default") {
    if (sources.endpoint === "default") {
      llm.endpoint = preset.endpoint;
      sources.endpoint = "preset";
    }
    if (sources.model === "default") {
      llm.model = preset.model;
      sources.model = "preset";
    }
  }
  if (!isHttpEndpoint(llm.endpoint)) {
    warnings.push(`endpoint 不是 http(s) URL：${endpointHost(llm.endpoint) || "无效地址"}。`);
  } else if (sources.endpoint !== "default" && sources.endpoint !== "preset") {
    const conflict = endpointProviderConflict(llm.provider, llm.endpoint);
    if (conflict) warnings.push(conflict);
  }
  if (!llm.api_key) {
    const resolved = resolveProviderApiKey(llm.provider, env, { startupProvider: llm.provider });
    if (resolved.apiKey) {
      llm.api_key = resolved.apiKey;
      sources.apiKey = "env";
    }
  }
}

export interface ProcessLlmSession {
  provider: string;
  endpoint: string;
  model: string;
  apiKey: string;
}

export function publishProcessLlmSession(session: ProcessLlmSession, env: EnvLike = process.env): void {
  env.QLING_LLM_SESSION_PROVIDER = session.provider;
  env.QLING_LLM_SESSION_ENDPOINT = session.endpoint;
  env.QLING_LLM_SESSION_MODEL = session.model;
  if (session.apiKey && session.apiKey !== "local") {
    env.QLING_LLM_SESSION_API_KEY = session.apiKey;
  } else {
    delete env.QLING_LLM_SESSION_API_KEY;
  }
}

export function resolveActiveLlm(env: EnvLike = process.env): ResolvedLlmSettings {
  const provider = String(env.QLING_LLM_SESSION_PROVIDER ?? "").trim();
  const endpoint = String(env.QLING_LLM_SESSION_ENDPOINT ?? "").trim();
  const model = String(env.QLING_LLM_SESSION_MODEL ?? "").trim();
  if (provider && endpoint && model) {
    const apiKey = String(env.QLING_LLM_SESSION_API_KEY ?? "");
    const known = lookupModelWindow(model);
    return {
      provider,
      endpoint,
      model,
      apiKey,
      sources: {
        provider: "session",
        endpoint: "session",
        model: "session",
        apiKey: "session",
      },
      warnings: [],
      contextWindow: known?.contextWindow ?? null,
      windowSource: known ? "model" : "legacy",
    };
  }
  return resolveLlmSettings({}, env);
}

export interface CredentialStatus {
  ready: boolean;
  requiresKey: boolean;
  badge: string;
  source: "env" | "session" | "none";
  message?: string;
}

export interface LocalConnectionEvidence {
  endpoint?: string;
  sessionApiKey?: string;
  currentProvider?: string;
  currentEndpoint?: string;
  authStateDir?: string;
  connection?: { profile: AuthProfile | null; status: "unconfigured" | "ready" | "needs_login" };
}

export function isProviderCredentialReady(
  provider: string,
  env: EnvLike = process.env,
  options: LocalConnectionEvidence = {}
): CredentialStatus {
  const norm = normalizeProviderId(provider);
  const preset = getProviderPreset(norm);
  const requiresKey = preset ? preset.requiresApiKey : true;

  if (!requiresKey || norm === "ollama" || norm === "local") {
    return { ready: true, requiresKey: false, badge: "⚡ 免Key", source: "none" };
  }

  const endpoint = options.endpoint ?? preset?.endpoint;
  const connection = options.connection;
  const profile = connection?.profile;
  const matches = profile?.provider === norm &&
    normalizeLlmEndpoint(profile.endpoint) === normalizeLlmEndpoint(endpoint);
  if (norm === "chatgpt" || norm === "grok-account") {
    const ready = Boolean(matches && connection?.status === "ready");
    return { ready, requiresKey: true, badge: ready ? "🔒 本地账号就绪" : "○ 需登录", source: ready ? "session" : "none",
      message: ready ? "账号凭据已附加；模型权限及推理尚未验证" : "账号缺失、已解除或需重新登录" };
  }
  if (matches && connection?.status === "ready" && profile?.method === "api_key") {
    return { ready: true, requiresKey: true, badge: "✓ 本地凭据", source: "session", message: "模型权限及推理尚未验证" };
  }
  const resolved = resolveProviderApiKey(norm, env, { ...options, endpoint,
    sameProvider: options.currentProvider === norm, startupProvider: env.QLING_LLM_STARTUP_PROVIDER ?? env.QLING_LLM_PROVIDER });
  if (!resolved.refused && isUsableApiKey(resolved.apiKey)) {
    return { ready: true, requiresKey: true, badge: "✓ 本地凭据", source: resolved.source === "session" ? "session" : "env", message: "模型权限及推理尚未验证" };
  }
  const envName = providerApiKeyEnv(norm);

  return {
    ready: false,
    requiresKey: true,
    badge: "○ 需配Key",
    source: "none",
    message: envName ? `未配置环境变量 ${envName}` : "缺少 API Key",
  };
}
