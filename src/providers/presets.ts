// ============================================================
// 轻灵 - Provider 预设（单一真相源）
// setup / /model / doctor 共用，避免各处硬编码分叉
// ============================================================

export interface ProviderPreset {
  /** 稳定 id，用于 /model use <id> */
  id: string;
  /** 展示名（中文优先） */
  displayName: string;
  /** QLING_LLM_PROVIDER 写入值 */
  provider: string;
  endpoint: string;
  model: string;
  keyHint?: string;
  /** 本地/无密钥场景为 false */
  requiresApiKey: boolean;
  /** 已知上下文窗口（token）。未知模型不填，压缩走 legacy。 */
  contextWindow?: number;
  maxOutputTokens?: number;
  tags?: string[];
}

export interface ModelWindowMeta {
  contextWindow: number;
  maxOutputTokens?: number;
}

/**
 * 官方公开窗口。数值来源查询日期 2026-10-16，只录已核实的 ID：
 * deepseek https://api-docs.deepseek.com/quick_start/pricing
 * dashscope https://help.aliyun.com/zh/model-studio/qwen3-7-plus
 * zhipu https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3
 * moonshot https://platform.kimi.com/docs/models.md
 * minimax https://platform.minimaxi.com/docs/guides/text-generation
 * mimo https://mimo.mi.com/docs/en-US/quick-start/summary/model
 * openai https://platform.openai.com/docs/models
 * 未列出的模型返回 null，不猜测。siliconflow 的 deepseek-ai/DeepSeek-V4.1-Flash 官方页未核实窗口，不录入。
 * 保留且未改数值：gpt-4o、gpt-4o-mini、glm-4、qwen-plus、Qwen/Qwen2.5-7B-Instruct、llama3。
 */
export const KNOWN_MODEL_WINDOWS: Record<string, ModelWindowMeta> = {
  "deepseek-flash": { contextWindow: 1000000, maxOutputTokens: 393216 },
  "deepseek-v4-pro": { contextWindow: 1000000, maxOutputTokens: 393216 },
  "deepseek-v4-flash": { contextWindow: 1000000, maxOutputTokens: 393216 },
  "qwen3.7-plus": { contextWindow: 1000000, maxOutputTokens: 131072 },
  "qwen-plus": { contextWindow: 128000 },
  "glm-5.3": { contextWindow: 1000000, maxOutputTokens: 131072 },
  "glm-5.3-flash": { contextWindow: 1000000, maxOutputTokens: 131072 },
  "glm-5.2": { contextWindow: 1000000, maxOutputTokens: 131072 },
  "glm-4": { contextWindow: 128000 },
  "kimi-k3": { contextWindow: 1000000 },
  "kimi-k2.7-code": { contextWindow: 256000 },
  "kimi-k2.6": { contextWindow: 256000 },
  "MiniMax-M3": { contextWindow: 1000000 },
  "MiniMax-M2.7": { contextWindow: 204800 },
  "mimo-v2.6-pro": { contextWindow: 1000000, maxOutputTokens: 131072 },
  "mimo-v2.6-flash": { contextWindow: 1000000, maxOutputTokens: 131072 },
  "gpt-6-astra": { contextWindow: 1050000, maxOutputTokens: 131072 },
  "gpt-6.1-sol": { contextWindow: 1050000, maxOutputTokens: 131072 },
  "gpt-4o": { contextWindow: 128000, maxOutputTokens: 16384 },
  "gpt-4o-mini": { contextWindow: 128000, maxOutputTokens: 16384 },
  "Qwen/Qwen2.5-7B-Instruct": { contextWindow: 32768 },
  llama3: { contextWindow: 8192 },
};

/** 官方已下线的 ID。值是建议替换的现役预设默认模型，不做静默改写。 */
export const RETIRED_MODELS: Record<string, string> = {
  "deepseek-chat": "deepseek-flash",
  "deepseek-reasoner": "deepseek-flash",
  "moonshot-v1-8k": "kimi-k3",
  "moonshot-v1-32k": "kimi-k3",
  "moonshot-v1-128k": "kimi-k3",
  "MiMo-V2.5-Pro": "mimo-v2.6-pro",
};

export function lookupModelWindow(model: string): ModelWindowMeta | null {
  const raw = String(model ?? "").trim();
  if (!raw) return null;
  if (KNOWN_MODEL_WINDOWS[raw]) return KNOWN_MODEL_WINDOWS[raw];
  const lower = raw.toLowerCase();
  for (const [key, value] of Object.entries(KNOWN_MODEL_WINDOWS)) {
    if (key.toLowerCase() === lower) return value;
  }
  return null;
}

export function lookupRetiredModel(model: string): string | null {
  const raw = String(model ?? "").trim();
  if (!raw) return null;
  if (RETIRED_MODELS[raw]) return RETIRED_MODELS[raw];
  const lower = raw.toLowerCase();
  for (const [key, value] of Object.entries(RETIRED_MODELS)) {
    if (key.toLowerCase() === lower) return value;
  }
  return null;
}

function withModelWindow(preset: ProviderPreset): ProviderPreset {
  const meta = lookupModelWindow(preset.model);
  if (!meta) return preset;
  return {
    ...preset,
    contextWindow: preset.contextWindow ?? meta.contextWindow,
    maxOutputTokens: preset.maxOutputTokens ?? meta.maxOutputTokens,
  };
}

/** setup 数字菜单用的有序列表（1-based 由调用方映射） */
export const PROVIDER_PRESET_ORDER: string[] = [
  "deepseek",
  "dashscope",
  "zhipu",
  "moonshot",
  "minimax",
  "mimo",
  "mimo-token-plan",
  "siliconflow",
  "openai",
  "ollama",
];

const PRESET_MAP: Record<string, ProviderPreset> = {
  deepseek: {
    id: "deepseek",
    displayName: "DeepSeek",
    provider: "deepseek",
    endpoint: "https://api.deepseek.com",
    model: "deepseek-flash",
    requiresApiKey: true,
    tags: ["china", "recommended"],
  },
  dashscope: {
    id: "dashscope",
    displayName: "阿里云百炼 (Qwen)",
    provider: "dashscope",
    endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen3.7-plus",
    keyHint: "阿里云 API Key",
    requiresApiKey: true,
    tags: ["china"],
  },
  zhipu: {
    id: "zhipu",
    displayName: "智谱清言 (GLM)",
    provider: "zhipu",
    endpoint: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-5.3",
    keyHint: "智谱 AI Key",
    requiresApiKey: true,
    tags: ["china"],
  },
  moonshot: {
    id: "moonshot",
    displayName: "月之暗面 (Kimi)",
    provider: "moonshot",
    endpoint: "https://api.moonshot.cn/v1",
    model: "kimi-k3",
    keyHint: "Kimi API Key",
    requiresApiKey: true,
    tags: ["china"],
  },
  minimax: {
    id: "minimax",
    displayName: "MiniMax (海螺)",
    provider: "minimax",
    endpoint: "https://api.minimaxi.com/v1",
    model: "MiniMax-M3",
    keyHint: "MiniMax API Key",
    requiresApiKey: true,
    tags: ["china"],
  },
  mimo: {
    id: "mimo",
    displayName: "Xiaomi MiMo (按量计费)",
    provider: "mimo",
    endpoint: "https://api.xiaomimimo.com/v1",
    model: "mimo-v2.6-pro",
    keyHint: "小米 MiMo sk-xxx",
    requiresApiKey: true,
    tags: ["china"],
  },
  "mimo-token-plan": {
    id: "mimo-token-plan",
    displayName: "Xiaomi MiMo (Token Plan 订阅)",
    provider: "mimo",
    endpoint: "https://token-plan-cn.xiaomimimo.com/v1",
    model: "mimo-v2.6-pro",
    keyHint: "小米 MiMo tp-xxx",
    requiresApiKey: true,
    tags: ["china"],
  },
  siliconflow: {
    id: "siliconflow",
    displayName: "硅基流动 (SiliconFlow)",
    provider: "siliconflow",
    endpoint: "https://api.siliconflow.cn/v1",
    model: "deepseek-ai/DeepSeek-V4.1-Flash",
    keyHint: "硅基流动 Key",
    requiresApiKey: true,
    tags: ["china"],
  },
  openai: {
    id: "openai",
    displayName: "OpenAI",
    provider: "openai",
    endpoint: "https://api.openai.com/v1",
    model: "gpt-6-astra",
    requiresApiKey: true,
    tags: ["global"],
  },
  ollama: {
    id: "ollama",
    displayName: "本地 Ollama",
    provider: "ollama",
    endpoint: "http://localhost:11434/v1",
    model: "llama3",
    keyHint: "Ollama（可留空）",
    requiresApiKey: false,
    tags: ["local"],
  },
  // 别名：历史 setup 用 local 命名
  local: {
    id: "local",
    displayName: "本地部署 (Ollama)",
    provider: "ollama",
    endpoint: "http://localhost:11434/v1",
    model: "llama3",
    keyHint: "Ollama（可留空）",
    requiresApiKey: false,
    tags: ["local", "alias"],
  },
};

/** Canonical default. Other modules import these instead of hard-coding a model id. */
export const DEFAULT_PROVIDER = "deepseek";
export const DEFAULT_MODEL = PRESET_MAP[DEFAULT_PROVIDER].model;

const ALIASES: Record<string, string> = {
  local: "ollama",
  ollama: "ollama",
  "llama": "ollama",
  "openai-compat": "openai",
  qwen: "dashscope",
  kimi: "moonshot",
  glm: "zhipu",
  deepseek: "deepseek",
};

export function listProviderPresets(options: { includeAliases?: boolean } = {}): ProviderPreset[] {
  const includeAliases = options.includeAliases === true;
  const ordered = PROVIDER_PRESET_ORDER.map((id) => PRESET_MAP[id]).filter(Boolean);
  const list = includeAliases ? Object.values(PRESET_MAP) : ordered;
  return list.map((preset) => withModelWindow(preset));
}

export function getProviderPreset(idOrAlias: string): ProviderPreset | undefined {
  const raw = String(idOrAlias ?? "").trim().toLowerCase();
  if (!raw) return undefined;

  // 数字索引 1..N → 有序列表
  if (/^\d+$/.test(raw)) {
    const index = Number(raw) - 1;
    const ordered = listProviderPresets();
    return ordered[index];
  }

  const canonical = ALIASES[raw] ?? raw;
  const direct = PRESET_MAP[canonical] ?? PRESET_MAP[raw];
  if (direct) return withModelWindow(direct);

  // 允许用 provider 字段模糊匹配第一个
  return listProviderPresets().find(
    (p) => p.provider.toLowerCase() === raw || p.id.toLowerCase() === raw
  );
}

export function resolveModelCandidates(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of listProviderPresets()) {
    if (!seen.has(p.model)) {
      seen.add(p.model);
      out.push(p.model);
    }
  }
  return out;
}

export function isLoopbackEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function apiKeyRequiredForEndpoint(endpoint: string, provider?: string): boolean {
  if (provider && (provider === "ollama" || provider === "local")) return false;
  if (endpoint && isLoopbackEndpoint(endpoint)) return false;
  const preset = provider ? getProviderPreset(provider) : undefined;
  if (preset) return preset.requiresApiKey;
  return true;
}

export function formatPresetTableLines(): string[] {
  const lines: string[] = [];
  const presets = listProviderPresets();
  presets.forEach((p, i) => {
    const key = p.requiresApiKey ? "key" : "no-key";
    lines.push(
      `${String(i + 1).padStart(2, " ")}. ${p.id.padEnd(16)} ${p.displayName}`
    );
    lines.push(`    provider=${p.provider}  model=${p.model}`);
    lines.push(`    endpoint=${p.endpoint}  (${key})`);
  });
  return lines;
}

function normalizeProviderId(provider: string | undefined): string {
  return String(provider ?? "").trim().toLowerCase();
}

/** Presets whose provider (or preset id) is the current session provider. Aliases stay out. */
export function presetsForProvider(provider: string): ProviderPreset[] {
  const id = normalizeProviderId(provider);
  if (!id) return [];
  return listProviderPresets().filter(
    (preset) => normalizeProviderId(preset.provider) === id || normalizeProviderId(preset.id) === id
  );
}

/**
 * 前缀归不进去、但属于同一服务商的现役/保留模型。只做精确 ID 映射，不放宽前缀。
 */
const MODEL_PROVIDER_AFFINITY: Record<string, string> = {
  "glm-5.2": "zhipu",
  "glm-4": "zhipu",
  "kimi-k2.7-code": "moonshot",
  "kimi-k2.6": "moonshot",
  "gpt-6.1-sol": "openai",
  "gpt-4o": "openai",
  "gpt-4o-mini": "openai",
  "qwen-plus": "dashscope",
  "qwen/qwen2.5-7b-instruct": "siliconflow",
};

function modelBelongsToPresets(modelName: string, presets: ProviderPreset[]): boolean {
  const lower = modelName.toLowerCase();
  const providerIds = new Set(presets.map((preset) => normalizeProviderId(preset.provider)));
  const affinity = MODEL_PROVIDER_AFFINITY[lower];
  if (affinity) return providerIds.has(affinity);
  const presetModels = presets.map((preset) => preset.model.toLowerCase()).filter(Boolean);
  if (presetModels.some((model) => model === lower)) return true;
  for (const providerId of providerIds) {
    if (lower.startsWith(`${providerId}-`) || lower.startsWith(`${providerId}/`)) return true;
  }
  return presetModels.some(
    (model) => lower.startsWith(`${model}-`) || lower.startsWith(`${model}/`)
  );
}

/** Known-window models owned by this provider. Unknown providers get nothing. */
export function knownModelsForProvider(provider: string): string[] {
  const presets = presetsForProvider(provider);
  if (presets.length === 0) return [];
  return Object.keys(KNOWN_MODEL_WINDOWS).filter((name) => modelBelongsToPresets(name, presets));
}

export interface ProviderModelEntry {
  id: string;
  model: string;
  label: string;
  description: string;
  presetId?: string;
  source: "preset" | "known" | "current";
}

/**
 * Current-provider rows: its presets, known models not already covered, then the
 * live model if it is not already listed. Preset rows are not collapsed.
 */
export function listProviderModelEntries(provider: string, currentModel?: string): ProviderModelEntry[] {
  const providerId = normalizeProviderId(provider);
  const entries: ProviderModelEntry[] = [];
  const seenModels = new Set<string>();
  for (const preset of presetsForProvider(provider)) {
    entries.push({
      id: preset.id,
      model: preset.model,
      label: preset.displayName || preset.id,
      description: `${preset.provider} · ${preset.model}`,
      presetId: preset.id,
      source: "preset",
    });
    seenModels.add(preset.model.toLowerCase());
  }
  for (const model of knownModelsForProvider(provider)) {
    if (seenModels.has(model.toLowerCase())) continue;
    seenModels.add(model.toLowerCase());
    entries.push({
      id: `model:${model}`,
      model,
      label: model,
      description: `${providerId} · 已知模型`,
      source: "known",
    });
  }
  const current = String(currentModel ?? "").trim();
  if (current && !seenModels.has(current.toLowerCase())) {
    entries.push({
      id: `model:${current}`,
      model: current,
      label: current,
      description: `${providerId || "当前"} · 当前模型`,
      source: "current",
    });
  }
  return entries;
}

export function providerModelNames(provider: string, currentModel?: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const entry of listProviderModelEntries(provider, currentModel)) {
    const key = entry.model.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(entry.model);
  }
  return names;
}

export function formatProviderModelLines(
  provider: string,
  currentModel?: string,
  options: { hint?: boolean } = {}
): string[] {
  const hint = options.hint !== false;
  const providerId = normalizeProviderId(provider);
  if (presetsForProvider(provider).length === 0) {
    const model = String(currentModel ?? "").trim() || "(无)";
    const lines = [`当前模型  : ${model}`];
    if (hint) lines.push("提示      : 未知服务商，没有预设模型。用 /model use <preset> 切换。");
    return lines;
  }
  const lines = [`范围      : 仅当前服务商 ${providerId}`];
  listProviderModelEntries(provider, currentModel).forEach((entry, index) => {
    const kind = entry.source === "preset" ? entry.label : entry.source === "known" ? "已知模型" : "当前模型";
    lines.push(`${String(index + 1).padStart(2, " ")}. ${entry.model}`);
    lines.push(`    ${kind}`);
  });
  return lines;
}
