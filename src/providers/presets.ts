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
 * 官方公开窗口。数值来源查询日期 2026-10-18，只录已核实的 ID：
 * deepseek https://api-docs.deepseek.com/quick_start/pricing
 *   deepseek-flash 当前版本 DeepSeek-V4.1-Flash-1017（https://api-docs.deepseek.com/zh-cn/updates/）
 *   deepseek-v4-flash / deepseek-v4-flash-vision-exp 已下线，请求暂时仍路由到 deepseek-flash
 *   deepseek-v4-pro 仍在价目表（DeepSeek-V4-Pro-0813），保留
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
  // --- DeepSeek ---
  "deepseek-flash": { contextWindow: 1000000, maxOutputTokens: 393216 },
  "deepseek-v4-pro": { contextWindow: 1000000, maxOutputTokens: 393216 },
  "deepseek-v4-flash": { contextWindow: 1000000, maxOutputTokens: 393216 },

  // --- 阿里云百炼 (DashScope / 通义千问) ---
  "qwen3.8-max": { contextWindow: 1000000, maxOutputTokens: 131072 },
  "qwen3.7-max": { contextWindow: 1000000, maxOutputTokens: 131072 },
  "qwen3.8-plus": { contextWindow: 1000000, maxOutputTokens: 131072 },
  "qwen3.7-plus": { contextWindow: 1000000, maxOutputTokens: 131072 },
  "qwen3.6-plus": { contextWindow: 1000000, maxOutputTokens: 131072 },
  "qwen3.5-plus": { contextWindow: 1000000, maxOutputTokens: 131072 },
  "qwen3.8-flash": { contextWindow: 1000000, maxOutputTokens: 131072 },
  "qwen3.7-flash": { contextWindow: 1000000, maxOutputTokens: 131072 },
  "qwen3-coder-plus": { contextWindow: 1000000, maxOutputTokens: 131072 },
  "qwen3-coder-flash": { contextWindow: 1000000, maxOutputTokens: 131072 },
  "qwen-max": { contextWindow: 128000, maxOutputTokens: 8192 },
  "qwen-plus": { contextWindow: 128000 },
  "Qwen/Qwen2.5-7B-Instruct": { contextWindow: 32768 },

  // --- 智谱清言 (Zhipu GLM) ---
  "glm-5.3": { contextWindow: 1000000, maxOutputTokens: 131072 },
  "glm-5.3-flash": { contextWindow: 1000000, maxOutputTokens: 131072 },
  "glm-5.2": { contextWindow: 1000000, maxOutputTokens: 131072 },
  "glm-5.1": { contextWindow: 1000000, maxOutputTokens: 131072 },
  "glm-5": { contextWindow: 1000000, maxOutputTokens: 131072 },
  "glm-4.7": { contextWindow: 128000, maxOutputTokens: 16384 },
  "glm-4-plus": { contextWindow: 128000, maxOutputTokens: 16384 },
  "glm-4": { contextWindow: 128000 },

  // --- 月之暗面 (Moonshot Kimi) ---
  "kimi-k3.1-pro": { contextWindow: 1000000, maxOutputTokens: 65536 },
  "kimi-k3": { contextWindow: 1000000 },
  "kimi-k2.7-code": { contextWindow: 256000 },
  "kimi-k2.6": { contextWindow: 256000 },

  // --- Anthropic (Claude) ---
  "claude-opus-5-5": { contextWindow: 1000000, maxOutputTokens: 131072 },
  "claude-sonnet-5-5": { contextWindow: 1000000, maxOutputTokens: 131072 },
  "claude-haiku-5-5": { contextWindow: 1000000, maxOutputTokens: 131072 },
  "claude-fable-5-1": { contextWindow: 500000, maxOutputTokens: 65536 },
  "claude-3-7-sonnet-latest": { contextWindow: 200000, maxOutputTokens: 64000 },
  "claude-3-5-sonnet-latest": { contextWindow: 200000, maxOutputTokens: 8192 },
  "claude-3-5-haiku-latest": { contextWindow: 200000, maxOutputTokens: 8192 },

  // --- Google Gemini ---
  "gemini-4-argon": { contextWindow: 2000000, maxOutputTokens: 131072 },
  "gemini-3.8-flash": { contextWindow: 1000000, maxOutputTokens: 65536 },
  "gemini-3.5-pro": { contextWindow: 1000000, maxOutputTokens: 65536 },
  "gemini-3.5-flash": { contextWindow: 1000000, maxOutputTokens: 65536 },
  "gemini-2.5-pro": { contextWindow: 1000000, maxOutputTokens: 65536 },
  "gemini-2.5-flash": { contextWindow: 1000000, maxOutputTokens: 65536 },
  "gemini-2.0-flash": { contextWindow: 1000000, maxOutputTokens: 8192 },

  // --- OpenAI ---
  "gpt-6-astra": { contextWindow: 1050000, maxOutputTokens: 131072 },
  "gpt-6.1-sol": { contextWindow: 1050000, maxOutputTokens: 131072 },
  "o4-mini": { contextWindow: 200000, maxOutputTokens: 100000 },
  "o3": { contextWindow: 200000, maxOutputTokens: 100000 },
  "o3-mini": { contextWindow: 200000, maxOutputTokens: 100000 },
  "o1": { contextWindow: 200000, maxOutputTokens: 100000 },
  "o1-mini": { contextWindow: 128000, maxOutputTokens: 65536 },
  "gpt-4o": { contextWindow: 128000, maxOutputTokens: 16384 },
  "gpt-4o-mini": { contextWindow: 128000, maxOutputTokens: 16384 },

  // --- MiniMax & Xiaomi ---
  "minimax-m3.1-flash": { contextWindow: 1000000, maxOutputTokens: 65536 },
  "MiniMax-M3": { contextWindow: 1000000 },
  "MiniMax-M2.7": { contextWindow: 204800 },
  "mimo-v2.6-pro": { contextWindow: 1000000, maxOutputTokens: 131072 },
  "mimo-v2.6-flash": { contextWindow: 1000000, maxOutputTokens: 131072 },

  // --- Mistral AI ---
  "deepseek-v4-1-flash-1017": { contextWindow: 128000, maxOutputTokens: 16384 },
  "codestral-latest": { contextWindow: 256000, maxOutputTokens: 32768 },
  "codestral-2508": { contextWindow: 256000, maxOutputTokens: 32768 },
  "mistral-large-latest": { contextWindow: 128000, maxOutputTokens: 32768 },
  "mistral-small-latest": { contextWindow: 128000, maxOutputTokens: 32768 },
  "mistral-vibe-cli-latest": { contextWindow: 256000, maxOutputTokens: 32768 },
  "zai-glm-5-3": { contextWindow: 128000, maxOutputTokens: 32768 },

  // --- Local / Other ---
  llama3: { contextWindow: 8192 },
};

/** 官方已下线的 ID。值是建议替换的现役预设默认模型，不做静默改写。 */
export const RETIRED_MODELS: Record<string, string> = {
  "deepseek-chat": "deepseek-flash",
  "deepseek-reasoner": "deepseek-flash",
  "deepseek-v4-flash": "deepseek-flash",
  "deepseek-v4-flash-vision-exp": "deepseek-flash",
  "moonshot-v1-8k": "kimi-k3",
  "moonshot-v1-32k": "kimi-k3",
  "moonshot-v1-128k": "kimi-k3",
  "mimo-v2.5-pro": "mimo-v2.6-pro",
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
  "mistral",
  "openai",
  "anthropic",
  "gemini",
  "openrouter",
  "ollama",
  "xai",
];

const PRESET_MAP: Record<string, ProviderPreset> = {
  xai: {
    id: "xai",
    displayName: "xAI (Grok)",
    provider: "xai",
    endpoint: "https://api.x.ai/v1",
    model: "grok-2-latest",
    keyHint: "xAI API Key",
    requiresApiKey: true,
    tags: ["global"],
    contextWindow: 131072,
    maxOutputTokens: 8192,
  },
  chatgpt: {
    id: "chatgpt",
    displayName: "ChatGPT account",
    provider: "chatgpt",
    endpoint: "https://api.openai.com/v1",
    model: "gpt-6.1-sol",
    requiresApiKey: true,
    tags: ["account"],
  },
  "grok-account": {
    id: "grok-account",
    displayName: "Grok account",
    provider: "grok-account",
    endpoint: "https://cli-chat-proxy.grok.com/v1",
    model: "grok-build",
    requiresApiKey: true,
    tags: ["account"],
  },
  deepseek: {
    id: "deepseek",
    displayName: "DeepSeek",
    provider: "deepseek",
    endpoint: "https://api.deepseek.com",
    model: "deepseek-flash",
    keyHint: "DeepSeek API Key",
    requiresApiKey: true,
    tags: ["china", "recommended"],
    contextWindow: 1000000,
    maxOutputTokens: 393216,
  },
  dashscope: {
    id: "dashscope",
    displayName: "阿里云百炼 (Qwen)",
    provider: "dashscope",
    endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen3.7-plus",
    keyHint: "阿里云 API Key",
    requiresApiKey: true,
    tags: ["china", "recommended"],
    contextWindow: 1000000,
    maxOutputTokens: 131072,
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
    contextWindow: 1000000,
    maxOutputTokens: 131072,
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
    contextWindow: 1000000,
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
    contextWindow: 1000000,
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
    contextWindow: 1000000,
    maxOutputTokens: 131072,
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
    contextWindow: 1000000,
    maxOutputTokens: 131072,
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
  mistral: {
    id: "mistral",
    displayName: "Mistral AI",
    provider: "mistral",
    endpoint: "https://api.mistral.ai/v1",
    model: "mistral-vibe-cli-latest",
    keyHint: "Mistral API Key",
    requiresApiKey: true,
    tags: ["global", "recommended"],
    contextWindow: 128000,
    maxOutputTokens: 32768,
  },
  openai: {
    id: "openai",
    displayName: "OpenAI",
    provider: "openai",
    endpoint: "https://api.openai.com/v1",
    model: "gpt-6-astra",
    keyHint: "OpenAI API Key",
    requiresApiKey: true,
    tags: ["global", "recommended"],
    contextWindow: 1050000,
    maxOutputTokens: 131072,
  },
  anthropic: {
    id: "anthropic",
    displayName: "Anthropic (Claude)",
    provider: "anthropic",
    endpoint: "https://api.anthropic.com/v1",
    model: "claude-sonnet-5-5",
    keyHint: "Anthropic API Key",
    requiresApiKey: true,
    tags: ["global", "recommended"],
    contextWindow: 1000000,
    maxOutputTokens: 65536,
  },
  gemini: {
    id: "gemini",
    displayName: "Google Gemini",
    provider: "gemini",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-3.8-flash",
    keyHint: "Gemini API Key",
    requiresApiKey: true,
    tags: ["global", "recommended"],
    contextWindow: 1048576,
    maxOutputTokens: 65536,
  },
  openrouter: {
    id: "openrouter",
    displayName: "OpenRouter",
    provider: "openrouter",
    endpoint: "https://openrouter.ai/api/v1",
    model: "anthropic/claude-sonnet-5-5",
    keyHint: "OpenRouter API Key",
    requiresApiKey: true,
    tags: ["global", "recommended"],
    contextWindow: 1000000,
    maxOutputTokens: 65536,
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
    contextWindow: 8192,
  },
  local: {
    id: "local",
    displayName: "本地部署 (Ollama)",
    provider: "ollama",
    endpoint: "http://localhost:11434/v1",
    model: "llama3",
    keyHint: "Ollama（可留空）",
    requiresApiKey: false,
    tags: ["local", "alias"],
    contextWindow: 8192,
  },
};

const ALIASES: Record<string, string> = {
  ds: "deepseek",
  local: "ollama",
  ollama: "ollama",
  mistral: "mistral",
  codestral: "mistral",
  llama: "ollama",
  "openai-compat": "openai",
  qwen: "dashscope",
  kimi: "moonshot",
  glm: "zhipu",
  deepseek: "deepseek",
  claude: "anthropic",
  anthropic: "anthropic",
  gemini: "gemini",
  google: "gemini",
  openrouter: "openrouter",
  grok: "xai",
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
  if (provider === "chatgpt" || provider === "grok-account") return true;
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
  return Object.values(PRESET_MAP).filter(preset => !preset.tags?.includes("alias")).filter(
    (preset) => normalizeProviderId(preset.provider) === id || normalizeProviderId(preset.id) === id
  );
}

/**
 * 前缀归不进去、但属于同一服务商的现役/保留模型。只做精确 ID 映射，不放宽前缀。
 */
const MODEL_PROVIDER_AFFINITY: Record<string, string> = {
  // Mistral
  "deepseek-v4-1-flash-1017": "mistral",
  "codestral-latest": "mistral",
  "codestral-2508": "mistral",
  "mistral-large-latest": "mistral",
  "mistral-small-latest": "mistral",
  "ministral-8b-latest": "mistral",
  "ministral-14b-latest": "mistral",
  "ministral-3b-latest": "mistral",
  "mistral-vibe-cli-latest": "mistral",
  "mistral-vibe-cli-with-tools": "mistral",
  "mistral-vibe-cli-fast": "mistral",
  "zai-glm-5-3": "mistral",
  "zai-glm-5-3-flash": "mistral",

  // DeepSeek
  "deepseek-flash": "deepseek",
  "deepseek-v4-pro": "deepseek",
  "deepseek-v4-flash": "deepseek",

  // OpenAI
  "gpt-6-astra": "openai",
  "gpt-6.1-sol": "openai",
  "o4-mini": "openai",
  "o3": "openai",
  "o3-mini": "openai",
  "o1": "openai",
  "o1-mini": "openai",
  "gpt-oss-120b": "openai",
  "gpt-oss-20b": "openai",
  "gpt-4o": "openai",
  "gpt-4o-mini": "openai",

  // Anthropic
  "claude-opus-5-5": "anthropic",
  "claude-fable-5-1": "anthropic",
  "claude-sonnet-5-5": "anthropic",
  "claude-haiku-5-5": "anthropic",
  "claude-sonnet-4-5-20250929": "anthropic",
  "claude-3-7-sonnet-latest": "anthropic",
  "claude-3-5-sonnet-latest": "anthropic",
  "claude-3-5-haiku-latest": "anthropic",

  // Google Gemini
  "gemini-4-argon": "gemini",
  "gemini-3.8-flash": "gemini",
  "gemini-3.5-pro": "gemini",
  "gemini-3.5-flash": "gemini",
  "gemini-3.1-pro": "gemini",
  "gemini-3.1-flash-lite": "gemini",
  "gemini-2.5-pro": "gemini",
  "gemini-2.5-flash": "gemini",
  "gemini-2.0-flash": "gemini",

  // 阿里云百炼 (DashScope)
  "qwen3.8-max": "dashscope",
  "qwen3.7-max": "dashscope",
  "qwen3.8-plus": "dashscope",
  "qwen3.7-plus": "dashscope",
  "qwen3.6-plus": "dashscope",
  "qwen3.5-plus": "dashscope",
  "qwen3.8-flash": "dashscope",
  "qwen3.7-flash": "dashscope",
  "qwen3-coder-plus": "dashscope",
  "qwen3-coder-flash": "dashscope",
  "qwen-max": "dashscope",
  "qwen-plus": "dashscope",
  "qwen2.5-coder-32b-instruct": "dashscope",

  // 智谱清言 (Zhipu)
  "glm-5.3": "zhipu",
  "glm-5.3-flash": "zhipu",
  "glm-5.2": "zhipu",
  "glm-4.7": "zhipu",
  "glm-4.7-flash": "zhipu",
  "glm-4": "zhipu",

  // 月之暗面 (Moonshot)
  "kimi-k3.1-pro": "moonshot",
  "kimi-k3": "moonshot",
  "kimi-k2.7-code": "moonshot",
  "kimi-k2.6": "moonshot",
  "moonshot-v1-8k": "moonshot",
  "moonshot-v1-32k": "moonshot",
  "moonshot-v1-128k": "moonshot",

  // MiniMax
  "minimax-m3.1-flash": "minimax",
  "minimax-m3": "minimax",
  "minimax-m2.7": "minimax",
  "minimax-m2.7-highspeed": "minimax",

  // Xiaomi MiMo
  "mimo-v2.6-pro": "mimo",
  "mimo-v2.6-flash": "mimo",

  // 硅基流动 (SiliconFlow)
  "deepseek-ai/deepseek-v4.1-flash": "siliconflow",
  "deepseek-ai/deepseek-v3": "siliconflow",
  "deepseek-ai/deepseek-r1": "siliconflow",
  "qwen/qwen2.5-coder-32b-instruct": "siliconflow",
  "qwen/qwen2.5-72b-instruct": "siliconflow",
  "meta-llama/meta-llama-3.1-405b-instruct": "siliconflow",

  // xAI
  "grok-2-latest": "xai",
  "grok-2": "xai",
  "grok-2-mini": "xai",
  "grok-4": "xai",
  "grok-build": "xai",

  // OpenRouter
  "anthropic/claude-3.7-sonnet": "openrouter",
  "anthropic/claude-sonnet-5-5": "openrouter",
  "deepseek/deepseek-r1": "openrouter",
  "deepseek/deepseek-chat": "openrouter",
  "google/gemini-2.0-flash-001": "openrouter",
  "meta-llama/llama-3.3-70b-instruct": "openrouter",

  // 本地 Ollama
  "deepseek-r1:latest": "ollama",
  "deepseek-r1:8b": "ollama",
  "deepseek-r1:14b": "ollama",
  "deepseek-r1:32b": "ollama",
  "qwen2.5-coder:latest": "ollama",
  "qwen2.5-coder:7b": "ollama",
  "qwen2.5-coder:14b": "ollama",
  "qwen2.5-coder:32b": "ollama",
  "llama3.3:latest": "ollama",
  "llama3.1:8b": "ollama",
  "llama3": "ollama",
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
  const candidateKeys = new Set([
    ...Object.keys(MODEL_PROVIDER_AFFINITY),
    ...Object.keys(KNOWN_MODEL_WINDOWS),
  ]);
  return Array.from(candidateKeys).filter((name) => modelBelongsToPresets(name, presets));
}

export interface ProviderModelEntry {
  id: string;
  model: string;
  label: string;
  description: string;
  presetId?: string;
  source: "preset" | "known" | "current";
  provider?: string;
}

export interface GroupedProviderSection {
  providerId: string;
  displayName: string;
  isCurrent: boolean;
  entries: ProviderModelEntry[];
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
      provider: preset.provider,
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
      provider: providerId,
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
      provider: providerId,
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


/**
 * 列出所有服务商及其模型，按服务商分组
 */
export function listAllGroupedProviderModelEntries(
  currentProvider?: string,
  currentModel?: string
): GroupedProviderSection[] {
  const normCurrent = normalizeProviderId(currentProvider);
  const sections: GroupedProviderSection[] = [];
  const handledProviders = new Set<string>();

  // 1. 标准预设服务商按 PROVIDER_PRESET_ORDER 处理
  for (const presetId of PROVIDER_PRESET_ORDER) {
    const preset = PRESET_MAP[presetId];
    if (!preset) continue;
    const providerKey = normalizeProviderId(preset.provider);
    if (handledProviders.has(providerKey)) continue;
    handledProviders.add(providerKey);

    const isCurrent = normCurrent === providerKey || Boolean(preset.id && normCurrent === normalizeProviderId(preset.id));
    const entries = listProviderModelEntries(providerKey, isCurrent ? currentModel : undefined);
    for (const e of entries) {
      if (!e.provider) e.provider = providerKey;
    }
    if (entries.length > 0) {
      sections.push({
        providerId: providerKey,
        displayName: preset.displayName || providerKey,
        isCurrent,
        entries,
      });
    }
  }

  // 2. 账号连接 (ChatGPT / Grok 等)
  for (const [id, preset] of Object.entries(PRESET_MAP)) {
    if (!preset.tags?.includes("account")) continue;
    const providerKey = normalizeProviderId(preset.provider);
    if (handledProviders.has(providerKey)) continue;
    handledProviders.add(providerKey);

    const isCurrent = normCurrent === providerKey;
    const entries = listProviderModelEntries(providerKey, isCurrent ? currentModel : undefined);
    for (const e of entries) {
      if (!e.provider) e.provider = providerKey;
    }
    if (entries.length > 0) {
      sections.push({
        providerId: providerKey,
        displayName: preset.displayName || providerKey,
        isCurrent,
        entries,
      });
    }
  }

  // 3. 当前服务商如果是未在预设中的自定义或未知服务商
  if (normCurrent && !handledProviders.has(normCurrent)) {
    const entries = listProviderModelEntries(normCurrent, currentModel);
    for (const e of entries) {
      if (!e.provider) e.provider = normCurrent;
    }
    sections.unshift({
      providerId: normCurrent,
      displayName: `自定义连接 (${normCurrent})`,
      isCurrent: true,
      entries,
    });
  }

  return sections;
}

export function formatAllGroupedProviderModelLines(
  currentProvider?: string,
  currentModel?: string
): string[] {
  const sections = listAllGroupedProviderModelEntries(currentProvider, currentModel);
  const lines: string[] = [];
  lines.push("范围      : 全部模型提供商（按服务商分组）");
  let totalIdx = 1;
  for (const section of sections) {
    const currBadge = section.isCurrent ? " ★ 当前" : "";
    lines.push(`\n[${section.displayName}${currBadge}]`);
    for (const entry of section.entries) {
      const kind = entry.source === "preset" ? entry.label : entry.source === "known" ? "已知模型" : "当前模型";
      lines.push(`${String(totalIdx++).padStart(3, " ")}. ${entry.model.padEnd(28)} (${kind})`);
    }
  }
  return lines;
}
